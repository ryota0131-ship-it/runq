const fs = require('fs');
const path = require('path');

function normalize(value){
  return String(value || '').normalize('NFKC').toLowerCase().replace(/第\s*\d+\s*回/g, '').replace(/[\s　・()（）\-ー]/g, '').replace(/大会$/g, '').replace(/マラソン大会$/g, 'まらそん');
}
function signature(row){ return [normalize(row.name), row.year || '', row.date || '', normalize(row.prefecture), normalize(row.city), row.distance || '', normalize(row.official_url)].join('|'); }
function validate(row){
  const errors=[];
  if(!String(row.name||'').trim()) errors.push('name is required');
  if(row.distance!==undefined && row.distance!=='' && (!Number.isFinite(Number(row.distance)) || Number(row.distance)<=0)) errors.push('distance must be a positive number');
  if(row.year && !/^\d{4}$/.test(String(row.year))) errors.push('year must be YYYY');
  if(row.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) errors.push('date must be YYYY-MM-DD');
  if(row.official_url && !/^https:\/\//.test(row.official_url)) errors.push('official_url must use https');
  return errors;
}
function parseCsv(text){
  const rows=text.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(v=>v.trim()));
  const headers=rows.shift()||[];
  return rows.map(values=>Object.fromEntries(headers.map((header,i)=>[header,values[i]||''])));
}
function upsert(catalog, rows){
  let added=0, updated=0, skipped=0; const errors=[];
  const bySignature=new Map(catalog.series.map(item=>[signature({name:item.name,prefecture:item.prefecture,city:item.city,distance:(item.distances||[])[0],official_url:item.official_url}),item]));
  rows.forEach((row,index)=>{
    const rowErrors=validate(row); if(rowErrors.length){ errors.push({line:index+2,errors:rowErrors}); return; }
    const key=signature(Object.assign({},row,{year:'',date:''})), found=bySignature.get(key);
    if(found){
      Object.assign(found,{name:row.name||found.name,kana:row.kana||found.kana,aliases:(row.aliases||'').split('|').filter(Boolean),prefecture:row.prefecture||found.prefecture,city:row.city||found.city,distances:[Number(row.distance)||found.distances[0]],official_url:row.official_url||found.official_url,updated_at:new Date().toISOString().slice(0,10)});
      if(row.year && !catalog.editions.some(e=>e.race_series_id===found.id && String(e.year)===String(row.year))){ catalog.editions.push({id:found.id+'-'+row.year,race_series_id:found.id,year:Number(row.year),held_on:row.date||null,entry_open_on:null,entry_close_on:null,distances:[Number(row.distance)],status:'scheduled',verification_status:row.date?'verified':'not_announced',last_verified_at:new Date().toISOString().slice(0,10),source_url:row.official_url||found.official_url}); }
      updated++; return;
    }
    if(!row.official_url){ skipped++; errors.push({line:index+2,errors:['official_url is required for master candidates']}); return; }
    const item={id:row.id||normalize(row.name).replace(/[^a-z0-9ぁ-んァ-ン一-龯]/g,'-').replace(/-+/g,'-'),name:row.name,kana:row.kana||'',aliases:(row.aliases||'').split('|').filter(Boolean),prefecture:row.prefecture||'',city:row.city||'',distances:[Number(row.distance)],kind:row.kind||'road',official_url:row.official_url,status:'master_verified'};
    catalog.series.push(item); bySignature.set(key,item);
    if(row.year) catalog.editions.push({id:item.id+'-'+row.year,race_series_id:item.id,year:Number(row.year),held_on:row.date||null,entry_open_on:null,entry_close_on:null,distances:[Number(row.distance)],status:'scheduled',verification_status:row.date?'verified':'not_announced',last_verified_at:new Date().toISOString().slice(0,10),source_url:row.official_url});
    added++;
  });
  return {added,updated,skipped,errors};
}
function writeBrowserCatalog(root,catalog){
  fs.writeFileSync(path.join(root,'app','race-catalog.generated.js'), '/* Generated from data/race-catalog.json. */\n(function(root){ root.RUNQ_RACE_CATALOG = '+JSON.stringify(catalog)+'; })(typeof window!==\'undefined\' ? window : globalThis);\n');
}
class LocalRaceCatalogProvider {
  constructor(catalog){ this.catalog=catalog; }
  search(query){ const q=normalize(query); return this.catalog.series.filter(item=>[item.name,item.kana,item.prefecture,item.city].concat(item.aliases||[]).some(value=>normalize(value).includes(q))); }
}
class CsvRaceCatalogImporter {
  import(catalog,csvText){ return upsert(catalog,parseCsv(csvText)); }
}
class ExternalRaceCatalogProvider {
  async search(){ throw new Error('External race catalog integration is not configured'); }
}
module.exports={normalize,signature,validate,parseCsv,upsert,writeBrowserCatalog,LocalRaceCatalogProvider,CsvRaceCatalogImporter,ExternalRaceCatalogProvider};
