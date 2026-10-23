// Test glue, not an alternative protocol implementation. All framing and ACKs
// use the unmodified pinned github.com/go-stomp/stomp/v3 client via a real broker.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	stomp "github.com/go-stomp/stomp/v3"
)

var body = []byte{65, 0, 255, 13, 10}

func label(version string) string {
	if version == "1.0" {
		return "wire-common"
	}
	value := " leading:中文\nslash\\ "
	if version == "1.2" {
		value += "\r"
	}
	return value
}

type traceConn struct {
	net.Conn
	file *os.File
	mu   sync.Mutex
}

func (c *traceConn) log(direction string, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Only synthetic, anonymous loopback test data. No credentials accepted.
	return json.NewEncoder(c.file).Encode(map[string]string{"direction": direction, "bytes_base64": base64.StdEncoding.EncodeToString(data)})
}
func (c *traceConn) Read(p []byte) (int, error) {
	n, e := c.Conn.Read(p)
	if n > 0 {
		if err := c.log("broker-to-go", p[:n]); err != nil {
			return n, err
		}
	}
	return n, e
}
func (c *traceConn) Write(p []byte) (int, error) {
	n, e := c.Conn.Write(p)
	if n > 0 {
		if err := c.log("go-to-broker", p[:n]); err != nil {
			return n, err
		}
	}
	return n, e
}

func run() error {
	version := flag.String("version", "", "Exactly one of 1.0, 1.1, 1.2")
	port := flag.Int("port", 61613, "Numeric loopback broker port")
	incoming := flag.String("incoming", "", "Node producer to Go consumer destination")
	outgoing := flag.String("outgoing", "", "Go producer to Node consumer destination")
	trace := flag.String("trace", "", "New trace file (required)")
	flag.Parse()
	if (*version != "1.0" && *version != "1.1" && *version != "1.2") || *port < 1 || *port > 65535 || *incoming == "" || *outgoing == "" || *trace == "" {
		return fmt.Errorf("invalid test arguments")
	}
	if *incoming == *outgoing {
		return fmt.Errorf("two distinct broker destinations required")
	}
	f, err := os.OpenFile(*trace, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	socket, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(*port)), 5*time.Second)
	if err != nil {
		return err
	}
	defer socket.Close()
	if err = socket.SetDeadline(time.Now().Add(20 * time.Second)); err != nil {
		return err
	}
	conn, err := stomp.Connect(&traceConn{Conn: socket, file: f},
		stomp.ConnOpt.AcceptVersion(stomp.Version(*version)), stomp.ConnOpt.Host("localhost"), stomp.ConnOpt.HeartBeat(0, 0),
		stomp.ConnOpt.RcvReceiptTimeout(5*time.Second), stomp.ConnOpt.SubscribeReceiptTimeout(5*time.Second),
		stomp.ConnOpt.UnsubscribeReceiptTimeout(5*time.Second), stomp.ConnOpt.DisconnectReceiptTimeout(5*time.Second))
	if err != nil {
		return err
	}
	if string(conn.Version()) != *version {
		return fmt.Errorf("selected %s instead of %s", conn.Version(), *version)
	}
	sub, err := conn.Subscribe(*incoming, stomp.AckClient, stomp.SubscribeOpt.Id("go"), stomp.SubscribeOpt.Receipt("go-ready"))
	if err != nil {
		return err
	}
	if err = json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "ready", "selected_version": string(conn.Version()), "subscription_receipt": true}); err != nil {
		return err
	}
	var msg *stomp.Message
	select {
	case item, ok := <-sub.C:
		if !ok {
			return fmt.Errorf("subscription closed")
		}
		msg = item
	case <-time.After(5 * time.Second):
		return fmt.Errorf("incoming message timeout")
	}
	if msg.Err != nil {
		return msg.Err
	}
	if !bytes.Equal(msg.Body, body) || msg.Header.Get("x-label") != label(*version) {
		return fmt.Errorf("Node-to-Go payload/header mismatch")
	}
	if err = conn.Ack(msg); err != nil {
		return err
	}
	if err = conn.Send(*outgoing, "application/octet-stream", body, stomp.SendOpt.Header("x-label", label(*version)), stomp.SendOpt.Receipt); err != nil {
		return err
	}
	if err = sub.Unsubscribe(); err != nil {
		return err
	}
	if err = conn.Disconnect(); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "done", "selected_version": *version, "node_to_go_verified": true, "go_to_node_sent_receipt": true, "unsubscribe_and_disconnect_completed": true})
}
func main() {
	if err := run(); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"error": err.Error()})
		os.Exit(1)
	}
}
