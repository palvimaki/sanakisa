#!/bin/bash
# Deploy latest code to the VPS.
# Run from project root: bash deploy/update.sh
# Or call directly on the server: bash /opt/sanakisa/deploy/update.sh

set -e

APP_DIR="/opt/sanakisa"

echo "==> Pulling latest code"
git -C $APP_DIR pull

echo "==> Reloading nginx (static files — no restart needed)"
sudo systemctl reload nginx

echo "==> Done."
