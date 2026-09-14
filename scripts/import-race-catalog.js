#!/usr/bin/env node
const fs=require('fs'); const path=require('path'); const {parseCsv,upsert,writeBrowserCatalog}=require('./race-catalog');
const root=path.resolve(__dirname,'..'); const args=process.argv.slice(2); const file=args[args.indexOf('--file')+1]; const dryRun=args.includes('--dry-run');
if(!file){ console.error('Usage: node scripts/import-race-catalog.js --file path/to/races.csv [--dry-run]'); process.exit(1); }
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data','race-catalog.json'),'utf8')); const result=upsert(catalog,parseCsv(fs.readFileSync(path.resolve(file),'utf8')));
console.log(JSON.stringify(Object.assign({dryRun},result),null,2));
if(!dryRun){ catalog.updated_at=new Date().toISOString().slice(0,10); fs.writeFileSync(path.join(root,'data','race-catalog.json'),JSON.stringify(catalog,null,2)+'\n'); writeBrowserCatalog(root,catalog); }
