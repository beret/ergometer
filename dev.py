#!/usr/bin/env python3

import os
import sys
import venv
from subprocess import run

os.chdir(os.path.dirname(os.path.abspath(__file__)))
is_windows = not run(["which", "cmd.exe"]).returncode
bin_dir = os.path.join("venv", "Scripts" if is_windows else "bin")


def mtime(path):
    return os.path.exists(path) and os.stat(path).st_mtime_ns


def make_venv(name, *args):
    path = os.path.join("venv", name)
    if not os.path.exists(os.path.join(path, "pyvenv.cfg")):
        venv.create(path, with_pip=True)


def build(*args):
    if is_windows and mtime("activity_monitor.exe") < mtime("activity_monitor.cpp"):
        run("cmd.exe /c build_activity_monitor.bat".split())
    make_venv("")
    run(f"{bin_dir}/pip install -q -r requirements.txt".split())


def freeze(*args):
    pip = os.path.join(bin_dir, "pip")
    run(f"{pip} freeze > requirements.txt", shell=True)


def test(*args):
    run([f"{bin_dir}/pytest", *args])


def upgrade(*args):
    lines = (
        run(
            f"{bin_dir}/pip list --format freeze --outdated".split(),
            capture_output=True,
        )
        .stdout.decode("ascii")
        .splitlines()
    )
    packages = " ".join(line.partition("==")[0] for line in lines)
    if not packages:
        return
    run(f"{bin_dir}/python -m pip install --upgrade {packages}".split())
    freeze()


if __name__ == "__main__" and len(sys.argv) > 1:
    cmd, *args = sys.argv[1:]
    dict(b=build, f=freeze, t=test, u=upgrade).get(cmd[0], lambda *args: ...)(*args)
