#!/bin/bash
set -e

# Update and install dependencies
echo "Updating system..."
sudo apt update
echo "Installing Node.js and Git..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx

# Setup project directory
cd ~
if [ -d "HtmlDeploy" ]; then
  echo "Repository exists. Pulling latest..."
  cd HtmlDeploy
  # We need to set remote to use the token to pull, or just use the token in clone
  git remote set-url origin https://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@github.com/Qiuzizhao/HtmlDeploy.git
  git pull origin main
else
  echo "Cloning repository..."
  git clone https://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@github.com/Qiuzizhao/HtmlDeploy.git
  cd HtmlDeploy
fi

# Configure git for auto-backup
git config --global user.name "Qiuzizhao"
git config --global user.email "qiuzizhao@example.com"
git config --global credential.helper store

# Install NPM dependencies
echo "Installing dependencies..."
npm install

# Setup PM2
echo "Setting up PM2..."
sudo npm install -g pm2
pm2 stop html-deploy || true
pm2 start server.js --name "html-deploy"
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu || true
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu || true

# Setup Nginx
echo "Configuring Nginx..."
sudo bash -c 'cat > /etc/nginx/sites-available/default <<EOF
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF'

sudo nginx -t
sudo systemctl restart nginx

echo "Deployment completed successfully!"