const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {finalize}=require('./finalize');

test('forged manifest and symlink cannot authorize delivery',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dual-seal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const raw=path.join(root,'raw');await fs.mkdir(raw);await fs.writeFile(path.join(root,'outside'),'outside');
 await fs.symlink(path.join(root,'outside'),path.join(raw,'app.apk'));await fs.writeFile(path.join(raw,'app.aab'),'bundle');
 await fs.writeFile(path.join(raw,'verified.json'),JSON.stringify([{name:'app.apk',verified:true}]));
 await assert.rejects(finalize(raw,path.join(__dirname,'../scripts'),false),/withheld/);
 assert.deepEqual((await fs.readdir(root)).filter(x=>x.startsWith('sealed-')),[]);
});
test('independent trusted verifier receives sealed copies and no configured signing passwords without consent',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dual-seal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const raw=path.join(root,'raw'),bin=path.join(root,'bin');await fs.mkdir(raw);await fs.mkdir(bin);
 for(const n of ['app.apk','app.aab'])await fs.writeFile(path.join(raw,n),'fixture');
 // Fake verifier for orchestration only: this does not prove Android artifact validity.
 await fs.writeFile(path.join(bin,'python3'),'#!'+process.execPath+'\nif(process.env.KEYSTORE_PASS)process.exit(7); const fs=require("fs"),path=require("path"),crypto=require("crypto"); console.log(JSON.stringify(process.argv.slice(3).map(f=>({name:path.basename(f),verified:true,sha256:crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}))));\n',{mode:0o700});
 const result=await finalize(raw,path.join(__dirname,'../scripts'),false,{PATH:bin+':'+process.env.PATH,KEYSTORE_PASS:'fixture-value'});
 assert.equal(result.verified.length,2);assert.notEqual(result.directory,raw);
 await fs.writeFile(path.join(raw,'app.apk'),'changed');assert.equal(await fs.readFile(path.join(result.directory,'app.apk'),'utf8'),'fixture');
 assert.equal((await fs.stat(result.directory)).mode&0o777,0o700);
});
