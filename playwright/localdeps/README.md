User-local copies of shared libraries Chromium needs (libnspr4, libnss3,
libasound2t64, libasound2-data) that aren't installed system-wide on this
WSL distro and couldn't be `apt install`ed because there's no interactive
sudo access in this session.

Obtained without root via:

```
apt-get download libnspr4 libnss3 libasound2t64 libasound2-data   # no sudo needed, just downloads .deb
dpkg-deb -x <file>.deb root                                       # no sudo needed, just extracts
```

`../env.js` points `LD_LIBRARY_PATH` at `root/usr/lib/x86_64-linux-gnu` so
Chromium's dynamic linker finds them. If the system ever gets proper
`playwright install-deps chromium` run via sudo, this directory becomes
unnecessary (but harmless to leave — LD_LIBRARY_PATH just adds a search
path).
