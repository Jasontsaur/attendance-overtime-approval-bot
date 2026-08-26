// Must be require()'d before 'playwright'. Points the dynamic linker at the
// user-local copies of libnspr4/libnss3/libasound2 extracted into
// localdeps/root (via `apt-get download` + `dpkg-deb -x`, no root needed —
// see localdeps/README.md), since this WSL distro doesn't have them
// installed system-wide and we don't have interactive sudo access here.
const path = require('path');

const LOCAL_LIB_DIR = path.join(__dirname, 'localdeps', 'root', 'usr', 'lib', 'x86_64-linux-gnu');

process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
  ? `${LOCAL_LIB_DIR}:${process.env.LD_LIBRARY_PATH}`
  : LOCAL_LIB_DIR;

module.exports = { LOCAL_LIB_DIR };
