#!/bin/bash
# Run once on the VPS as administrator to set up sanakisa.fi
# Usage: bash deploy/setup_server.sh
#
# The server already has git, nginx, and certbot from hoitovirhe.fi setup.
# This script only adds the sanakisa site on top.

set -e

APP_DIR="/opt/sanakisa"
REPO_URL="https://github.com/palvimaki/sanakisa.git"
DOMAIN="sanakisa.fi"

echo "==> Cloning repository"
sudo mkdir -p $APP_DIR
sudo git clone $REPO_URL $APP_DIR
sudo chown -R administrator:administrator $APP_DIR

echo "==> Configuring nginx"
sudo cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/sanakisa.fi
sudo ln -sf /etc/nginx/sites-available/sanakisa.fi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo "==> Requesting SSL certificate"
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

echo "==> Done. Site live at https://$DOMAIN/"
