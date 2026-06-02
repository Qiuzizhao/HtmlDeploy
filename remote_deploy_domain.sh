#!/bin/bash
set -e

APP_DIR="/home/ubuntu/HtmlDeploy"
PORT=3005
DOMAIN="htmldeploy.qiuzizhao.com"

echo "Updating application on custom port..."
cd $APP_DIR

echo "Installing production dependencies..."
npm install --omit=dev

echo "Ensuring Playwright Chromium is installed..."
npx playwright install --with-deps chromium

# 停止并删除旧的实例（如果存在）
pm2 delete html-deploy || true

# 使用新的端口启动，避免和服务器上其他服务（如 salary-manager）冲突
PORT=$PORT pm2 start server.js --name "html-deploy"
pm2 save

echo "Configuring Nginx..."
sudo bash -c "cat > /etc/nginx/sites-available/htmldeploy <<'NGINX'
server {
    listen 80;
    server_name htmldeploy.qiuzizhao.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX"

# 启用该配置
sudo ln -sf /etc/nginx/sites-available/htmldeploy /etc/nginx/sites-enabled/

# 测试 nginx 配置并重启
sudo nginx -t
sudo systemctl restart nginx

echo "Domain configuration completed!"
