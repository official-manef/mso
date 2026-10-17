"""PTY regression fixtures only; never targets an installed MSO environment."""
import errno
import os
import pty
import select
import signal
import sys
import termios
import time


def start(root):
    pid, fd = pty.fork()
    if pid == 0:
        os.execv('/bin/bash', ['bash', root + '/bin/mso', 'passwd'])
    return pid, fd


def until(fd, marker):
    output = b''
    deadline = time.monotonic() + 8
    while marker not in output:
        if time.monotonic() > deadline:
            raise AssertionError('prompt timeout')
        if select.select([fd], [], [], 0.1)[0]:
            try:
                data = os.read(fd, 4096)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output += data
    assert marker in output, 'expected prompt not reached'
    assert not termios.tcgetattr(fd)[3] & termios.ECHO, 'password echo enabled'
    return output


def finish(pid, fd):
    output = b''
    deadline = time.monotonic() + 8
    status = None
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.05)[0]:
            try:
                data = os.read(fd, 4096)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output += data
    else:
        os.kill(pid, signal.SIGKILL)
        raise AssertionError('child timeout')
    _, status = os.waitpid(pid, 0)
    os.close(fd)
    return os.waitstatus_to_exitcode(status), output


root, cancelled = sys.argv[1:]
pid, fd = start(root)
output = until(fd, b'New password: ')
assert not os.path.exists(root + '/.env.local'), 'credentials created before input'
os.write(fd, b'fixture-hidden-123\n')
output += until(fd, b'Confirm password: ')
assert not os.path.exists(root + '/.env.local'), 'credentials created before confirmation'
os.write(fd, b'fixture-hidden-123\n')
code, tail = finish(pid, fd)
assert code == 0, 'fresh setup failed'
assert b'fixture-hidden-123' not in output + tail, 'password was echoed'

pid, fd = start(root)
output = until(fd, b'Current password: ')
os.write(fd, b'fixture-hidden-123\n')
output += until(fd, b'New password: ')
os.write(fd, b'fixture-replaced-456\n')
output += until(fd, b'Confirm password: ')
os.write(fd, b'fixture-replaced-456\n')
code, tail = finish(pid, fd)
assert code == 0, 'rotation failed'
assert b'fixture-hidden-123' not in output + tail, 'current password echoed'
assert b'fixture-replaced-456' not in output + tail, 'new password echoed'

pid, fd = start(cancelled)
until(fd, b'New password: ')
os.write(fd, b'\x03')
code, _ = finish(pid, fd)
assert code != 0, 'cancel returned success'
assert not os.path.exists(cancelled + '/.env.local'), 'cancel wrote credentials'
print('PTY hidden input, confirmation and cancellation passed')
