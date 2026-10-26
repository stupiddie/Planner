// Run against a disposable MySQL database: MYSQL_DATABASE=planner_management_test ... node --test test/management.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

test('management permissions, feedback, activity and password lifecycle', { timeout: 60000 }, async t => {
  assert.match(process.env.MYSQL_DATABASE || '', /_test$/, 'Use an explicitly configured disposable database ending in _test');
  const root = path.join(__dirname, '..');
  const db = await mysql.createConnection({host:process.env.MYSQL_HOST || '127.0.0.1',port:Number(process.env.MYSQL_PORT || 3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD || '',database:process.env.MYSQL_DATABASE});
  const accounts=[];
  let child;
  t.after(async()=>{
    if(child && child.exitCode===null){child.kill();await once(child,'exit');}
    try {if(accounts.length)await db.query('DELETE FROM users WHERE id IN (?)',[accounts]);} finally {await db.end();}
  });
  for (const sql of fs.readFileSync(path.join(root,'schema.sql'),'utf8').split(';').filter(sql => sql.trim() && !/^\s*(CREATE DATABASE|USE )/i.test(sql))) await db.query(sql);
  const cli = args => spawnSync(process.execPath, ['manage.js',...args], {cwd:root,env:process.env,encoding:'utf8'});
  assert.equal(cli(['migrate']).status,0);
  assert.equal(cli(['migrate']).status,0);
  const port = 3127;
  child = spawn(process.execPath, ['server.js'], {cwd:root,env:{...process.env,PORT:String(port),COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
  let logs = ''; child.stdout.on('data', chunk => {logs+=chunk;}); child.stderr.on('data',chunk=>{logs+=chunk;});
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++) {
    try { await fetch(base); break; } catch {if(child.exitCode!==null) throw new Error(logs); await new Promise(r=>setTimeout(r,50));}
  }
  async function request(url, {cookie,method='GET',body}={}) {
    const response = await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text(); let data; try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const suffix=crypto.randomBytes(5).toString('hex'), password='testing-original-password';
  async function register(label,extra={}) {
    const username=`test_${label}_${suffix}`;
    const result=await request('/api/account/register',{method:'POST',body:{username,password,...extra}});
    assert.equal(result.status,201); accounts.push(result.data.id);
    return {...result.data,username,cookie:result.cookie};
  }
  const admin=await register('admin'), user=await register('user',{role:'admin'}), other=await register('other');
  assert.equal(cli(['grant-admin',admin.username]).status,0);
  assert.notEqual(cli(['grant-admin','missing_'+suffix]).status,0);
  assert.notEqual(cli(['grant-admin',admin.username.toUpperCase()]).status,0);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let feedbackId, imageId;

  await t.test('anonymous/normal accounts cannot access admin; role is resolved server-side',async()=>{
    const health=await request('/api/health');assert.equal(health.status,200);assert.deepEqual(health.data,{ok:true,database:true});
    for(const endpoint of ['/api/admin/summary','/api/admin/users','/api/admin/feedback']){
      assert.equal((await request(endpoint)).status,401);
      assert.equal((await request(endpoint,{cookie:user.cookie})).status,403);
      assert.equal((await request(endpoint,{cookie:admin.cookie})).status,200);
    }
    assert.equal((await request('/api/account/me',{cookie:user.cookie})).data.role,'user');
    assert.equal((await request('/api/account/me',{cookie:admin.cookie})).data.role,'admin');
    for(const endpoint of ['/server/management-schema.sql','/server/server.js','/server/.env','/deploy/README.md'])assert.equal((await request(endpoint)).status,404);
  });
  await t.test('display name is stored on registration and updated through the account profile',async()=>{
    assert.equal((await request('/api/account/profile',{method:'PUT',body:{displayName:'匿名'}})).status,401);
    assert.equal((await request('/api/account/me',{cookie:user.cookie})).data.display_name,'');
    const named=await register('named',{displayName:'  小明  '});
    assert.equal((await request('/api/account/me',{cookie:named.cookie})).data.display_name,'小明');
    const updated=await request('/api/account/profile',{method:'PUT',cookie:named.cookie,body:{displayName:'新名称'}});
    assert.equal(updated.status,200);assert.equal(updated.data.display_name,'新名称');
    assert.equal((await request('/api/account/me',{cookie:named.cookie})).data.display_name,'新名称');
    for(const body of [{},{displayName:123},{displayName:'a'.repeat(61)}])assert.equal((await request('/api/account/profile',{method:'PUT',cookie:named.cookie,body})).status,400);
    assert.equal((await request('/api/account/me',{cookie:named.cookie})).data.display_name,'新名称');
  });
  await t.test('feedback validates input and stores text and authentic image bytes',async()=>{
    assert.equal((await request('/api/feedback',{method:'POST',body:{message:'x'}})).status,401);
    for(const body of [{},{message:'a'.repeat(5001)},{images:[png,png,png,png]},{images:['data:image/svg+xml;base64,PHN2Zz4=']},{images:['data:image/png;base64,YWJjZA==']},{images:['data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(1024*1024)]).toString('base64')]}]) {
      assert.equal((await request('/api/feedback',{method:'POST',cookie:user.cookie,body})).status,400);
    }
    const result=await request('/api/feedback',{method:'POST',cookie:user.cookie,body:{message:'体验反馈 🐧 <img src=x onerror=alert(1)>',images:[png]}});
    assert.equal(result.status,201);feedbackId=result.data.id;
    const own=await request('/api/feedback',{cookie:user.cookie});
    const item=own.data.items.find(item=>item.id===feedbackId);
    assert.ok(item.message.includes('🐧'));assert.equal(item.images.length,1);imageId=item.images[0];
    assert.equal((await request('/api/feedback',{method:'POST',cookie:other.cookie,body:{images:[png]}})).status,201);
    assert.equal((await request('/api/feedback',{method:'POST',cookie:other.cookie,body:{message:'仅文字反馈'}})).status,201);
  });
  await t.test('feedback and image isolation; administrator can mark feedback handled',async()=>{
    assert.equal((await request('/api/feedback',{cookie:other.cookie})).data.items.some(item=>item.id===feedbackId),false);
    const image=`/api/feedback/images/${imageId}`;
    assert.equal((await request(image)).status,401);
    assert.equal((await request(image,{cookie:other.cookie})).status,404);
    for(const account of [user,admin]) {
      const response=await fetch(base+image,{headers:{Cookie:account.cookie}});
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(png.split(',')[1],'base64')));
    }
    assert.equal((await request(`/api/admin/feedback/${feedbackId}`,{method:'PATCH',cookie:user.cookie,body:{status:'resolved'}})).status,403);
    assert.equal((await request(`/api/admin/feedback/${feedbackId}`,{method:'PATCH',cookie:admin.cookie,body:{status:'invalid'}})).status,400);
    assert.equal((await request(`/api/admin/feedback/${feedbackId}`,{method:'PATCH',cookie:admin.cookie,body:{status:'resolved'}})).status,204);
    assert.equal((await request('/api/feedback',{cookie:user.cookie})).data.items.find(item=>item.id===feedbackId).status,'resolved');
  });
  await t.test('admin statistics include activity but never password hashes or personal data',async()=>{
    const sentinel=`PRIVATE_PLAN_${suffix}`;
    assert.equal((await request('/api/data',{method:'PUT',cookie:user.cookie,body:{story:sentinel}})).status,204);
    assert.equal((await request('/api/data',{cookie:admin.cookie})).data.story,undefined);
    const summary=(await request('/api/admin/summary',{cookie:admin.cookie})).data;
    assert.ok(summary.totalUsers>=3);assert.ok(summary.active24h>=3);assert.ok(summary.active7d>=3);assert.ok(summary.active30d>=3);
    const users=(await request('/api/admin/users',{cookie:admin.cookie})).data;
    const record=users.items.find(item=>item.id===user.id);
    assert.equal(record.activeDays30,1);assert.ok(record.last_seen_at);
    await db.execute('INSERT INTO user_activity_days (user_id,active_date) VALUES (?,UTC_DATE() - INTERVAL 1 DAY),(?,UTC_DATE() - INTERVAL 40 DAY)',[user.id,user.id]);
    assert.equal((await request('/api/admin/users',{cookie:admin.cookie})).data.items.find(item=>item.id===user.id).activeDays30,2);
    for(const endpoint of ['/api/admin/users','/api/admin/summary','/api/admin/feedback']) {
      const serialized=JSON.stringify((await request(endpoint,{cookie:admin.cookie})).data);
      assert.ok(!serialized.includes(sentinel));assert.ok(!serialized.includes('password_hash'));assert.ok(!serialized.includes('scrypt$'));
    }
    await db.execute('UPDATE user_activity SET last_seen_at=UTC_TIMESTAMP() - INTERVAL 40 DAY WHERE user_id=?',[other.id]);
    const before=(await request('/api/admin/summary',{cookie:admin.cookie})).data;
    assert.equal(before.active30d,summary.active30d-1);
    assert.equal((await request('/api/account/activity',{method:'POST',cookie:other.cookie})).status,204);
    assert.equal((await request('/api/admin/summary',{cookie:admin.cookie})).data.active30d,summary.active30d);
  });
  await t.test('pagination and status validation',async()=>{
    const empty=await request('/api/admin/users?page=9999',{cookie:admin.cookie});assert.equal(empty.status,200);assert.deepEqual(empty.data.items,[]);
    assert.equal((await request('/api/feedback?page=-1',{cookie:user.cookie})).data.page,1);
    assert.equal((await request('/api/admin/feedback/999999999',{method:'PATCH',cookie:admin.cookie,body:{status:'read'}})).status,404);
  });
  await t.test('password reset revokes sessions, returns temporary password once, and supports changing it',async()=>{
    const endpoint=`/api/admin/users/${user.id}/reset-password`;
    assert.equal((await request(endpoint,{method:'POST',cookie:other.cookie})).status,403);
    assert.equal((await request(`/api/admin/users/${admin.id}/reset-password`,{method:'POST',cookie:admin.cookie})).status,400);
    const reset=await request(endpoint,{method:'POST',cookie:admin.cookie});assert.equal(reset.status,200);
    const temporary=reset.data.temporaryPassword;assert.ok(temporary.length>=20);
    assert.equal((await request('/api/account/me',{cookie:user.cookie})).status,401);
    assert.equal((await request('/api/account/login',{method:'POST',body:{username:user.username,password}})).status,401);
    const login=await request('/api/account/login',{method:'POST',body:{username:user.username,password:temporary}});assert.equal(login.status,200);
    assert.equal((await request('/api/account/password',{method:'POST',cookie:login.cookie,body:{oldPassword:'wrong',newPassword:'testing-new-password'}})).status,400);
    assert.equal((await request('/api/account/password',{method:'POST',cookie:login.cookie,body:{oldPassword:temporary,newPassword:'testing-new-password'}})).status,204);
    assert.equal((await request('/api/account/me',{cookie:login.cookie})).status,401);
    assert.equal((await request('/api/account/login',{method:'POST',body:{username:user.username,password:'testing-new-password'}})).status,200);
  });
  await t.test('feedback daily limit rejects additional submissions without saving them',async()=>{
    for(let i=0;i<18;i++)assert.equal((await request('/api/feedback',{method:'POST',cookie:other.cookie,body:{message:`Limit test ${i}`}})).status,201);
    assert.equal((await request('/api/feedback',{method:'POST',cookie:other.cookie,body:{message:'Over the limit'}})).status,429);
    assert.equal((await request('/api/feedback',{cookie:other.cookie})).data.total,20);
  });
});
