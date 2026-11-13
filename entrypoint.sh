#!/bin/sh
# Start as root only long enough to make /data writable by the node user, then drop privileges.
set -eu
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  chown node:node /data
  chmod 700 /data
  exec su-exec node "$@"
fi
exec "$@"
