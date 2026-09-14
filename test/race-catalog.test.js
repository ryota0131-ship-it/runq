const assert=require('assert');
const fs=require('fs');
const {normalize,parseCsv,upsert}=require('../scripts/race-catalog');
const catalog=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','data','race-catalog.json'),'utf8'));

assert(catalog.series.length>=50,'initial catalog should contain at least 50 series');
assert(catalog.editions.every(e=>e.race_series_id),'editions must reference a series');
assert.strictEqual(normalize('第12回　東京マラソン大会'),normalize('東京マラソン'),'normalizes ordinal and tournament suffix');
assert(catalog.series.some(r=>[r.name,r.kana].join('|').includes('とうきょう')),'kana is searchable');
assert(catalog.series.some(r=>r.aliases.includes('アオタイ')),'aliases are retained');
const clone=JSON.parse(JSON.stringify(catalog));
const rows=parseCsv('id,name,kana,aliases,prefecture,city,distance,kind,official_url,year,date\nnew-race,新規マラソン,しんきまらそん,新規,東京都,例市,10,road,https://example.org,2027,');
const first=upsert(clone,rows); assert.strictEqual(first.added,1); assert.strictEqual(clone.series.length,catalog.series.length+1);
const second=upsert(clone,rows); assert.strictEqual(second.updated,1); assert.strictEqual(clone.series.length,catalog.series.length+1,'upsert must not duplicate');
const bad=upsert(clone,parseCsv('id,name,kana,aliases,prefecture,city,distance,kind,official_url,year,date\n,,, ,,,,bad,road,http://bad,20,not-a-date'));
assert(bad.errors.length>0,'invalid csv is reported');
console.log('race catalog tests: ok');
