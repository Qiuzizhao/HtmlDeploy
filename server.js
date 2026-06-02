const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('./src/app');

const port = Number(process.env.PORT || 3000);

for (const dir of ['data', path.join('storage', 'sites'), 'public']) {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
}

const app = createApp();

app.listen(port, () => {
  console.log(`HtmlDeploy running at http://localhost:${port}`);
});
