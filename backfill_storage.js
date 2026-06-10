const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createRuntimeStore } = require('./src/db/runtime-store');

async function getDirectorySize(dir) {
  try {
    const stats = await fsp.stat(dir);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const files = await fsp.readdir(dir);
    const sizes = await Promise.all(
      files.map((file) => getDirectorySize(path.join(dir, file)))
    );

    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

async function main() {
  console.log('Starting backfill script...');
  const dataDir = path.join(__dirname, 'data');
  const dbFile = path.join(dataDir, 'app.db');
  const storageDir = path.join(__dirname, 'storage', 'sites');
  
  if (!fs.existsSync(dbFile)) {
    console.error('db file not found:', dbFile);
    return;
  }

  const store = createRuntimeStore({ dataDir, dbFile });
  
  const sites = store.listSites();
  console.log(`Found ${sites.length} sites. Checking storage...`);
  
  let updatedCount = 0;
  for (const site of sites) {
    if (site.storageBytes === undefined || site.storageBytes === null || site.storageBytes === 0) {
      const siteDir = path.join(storageDir, site.id);
      if (fs.existsSync(siteDir)) {
        const size = await getDirectorySize(siteDir);
        if (size > 0) {
          site.storageBytes = size;
          site.storageUpdatedAt = site.storageUpdatedAt || new Date().toISOString();
          updatedCount++;
        }
      }
    }
  }
  
  if (updatedCount > 0) {
    store.replaceSites(sites);
    console.log(`Updated ${updatedCount} sites with storage size.`);
  } else {
    console.log('No sites needed storage update.');
  }
}

main().catch(console.error);
