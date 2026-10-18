#!/usr/bin/env python3
"""Offline negative controls for fail-closed broker guards; also run with -O."""
import importlib.util
from pathlib import Path
import tempfile
import sys
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('broker_runner', Path(__file__).with_name('broker-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

spec = importlib.util.spec_from_file_location('downstream_runner', Path(__file__).with_name('downstream.py'))
downstream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downstream)

BROKER = '''<configuration xmlns="urn:activemq:core"><acceptors><acceptor name="stomp">tcp://127.0.0.1:61613?protocols=STOMP;useEpoll=false</acceptor></acceptors><persistence-enabled>false</persistence-enabled><security-enabled>false</security-enabled><jmx-management-enabled>false</jmx-management-enabled></configuration>'''
BOOTSTRAP = '<broker xmlns="http://activemq.apache.org/schema"/>'
LISTENER = 'java 123 user 12u IPv4 123 0t0 TCP 127.0.0.1:61613 (LISTEN)\n'

class Guards(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bootstrap = Path(self.directory.name) / 'bootstrap.xml'
        self.bootstrap.write_text(BOOTSTRAP)

    def test_valid_profile(self):
        runner.validate_configuration(BROKER, self.bootstrap)
        runner.validate_listeners(LISTENER)
        runner.validate_extended({'passed': True, 'compatible_cases': 5})

    def test_non_loopback_acceptor_rejected(self):
        for host in ['0.0.0.0', 'localhost', '[::]', '192.0.2.1']:
            with self.subTest(host=host), self.assertRaises(RuntimeError):
                runner.validate_configuration(BROKER.replace('127.0.0.1', host), self.bootstrap)

    def test_multiple_or_missing_acceptors_rejected(self):
        extra = '<acceptor>tcp://0.0.0.0:61616?protocols=CORE</acceptor>'
        for xml in [BROKER.replace('</acceptors>', extra + '</acceptors>'), BROKER.replace('acceptor name="stomp"', 'other name="stomp"').replace('</acceptor>', '</other>')]:
            with self.subTest(xml=xml), self.assertRaises(RuntimeError):
                runner.validate_configuration(xml, self.bootstrap)

    def test_required_settings_fail_closed(self):
        for tag in ['persistence-enabled', 'security-enabled', 'jmx-management-enabled']:
            field = '<' + tag + '>false</' + tag + '>'
            for xml in [BROKER.replace(field, ''), BROKER.replace(field, field.replace('false', 'true'))]:
                with self.subTest(tag=tag, xml=xml), self.assertRaises(RuntimeError):
                    runner.validate_configuration(xml, self.bootstrap)

    def test_web_listener_rejected(self):
        self.bootstrap.write_text('<broker xmlns="http://activemq.apache.org/schema"><web bind="http://0.0.0.0:8161"/></broker>')
        with self.assertRaises(RuntimeError):
            runner.validate_configuration(BROKER, self.bootstrap)

    def test_actual_wrong_or_extra_listeners_rejected(self):
        for text in ['', LISTENER.replace('127.0.0.1', '*'), LISTENER.replace('61613', '61614'), LISTENER + LISTENER, LISTENER + LISTENER.replace('127.0.0.1:61613', '*:8161')]:
            with self.subTest(text=text), self.assertRaises(RuntimeError):
                runner.validate_listeners(text)

    def test_false_or_incomplete_success_evidence_rejected(self):
        for result in [{}, {'passed': False, 'compatible_cases': 5}, {'passed': 'true', 'compatible_cases': 5}, {'passed': 1, 'compatible_cases': 5}, {'passed': True, 'compatible_cases': 4}]:
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                runner.validate_extended(result)

    def test_corrupt_archive_rejected(self):
        bundle = SimpleNamespace(testzip=lambda: 'bad.mbt', namelist=lambda: ['main.mbt'])
        with self.assertRaises(RuntimeError):
            downstream.validate_archive(bundle)

    def test_unsafe_archive_paths_rejected(self):
        for name in ['/tmp/outside', '../outside', '.git/config', '_build/bridge.js']:
            bundle = SimpleNamespace(testzip=lambda: None, namelist=lambda: [name])
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                downstream.validate_archive(bundle)
        downstream.validate_archive(SimpleNamespace(testzip=lambda: None, namelist=lambda: ['main.mbt']))

if __name__ == '__main__':
    print('Python optimize level:', sys.flags.optimize, flush=True)
    unittest.main(verbosity=2)
