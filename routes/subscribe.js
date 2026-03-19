const express=require('express');const router=express.Router();const fs=require('fs');const path=require('path');
const SUBS_FILE=path.join(__dirname,'..','data','subscribers.json');
function loadSubs(){try{if(!fs.existsSync(SUBS_FILE))return[];return JSON.parse(fs.readFileSync(SUBS_FILE,'utf8'))}catch(e){return[]}}
function saveSubs(d){const dir=path.dirname(SUBS_FILE);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(SUBS_FILE,JSON.stringify(d,null,2))}
router.post('/',(req,res)=>{try{const{name,email,company,phone,industries,locations,plan,min_price,max_price}=req.body;if(!email)return res.status(400).json({error:'Email required'});if(!name)return res.status(400).json({error:'Name required'});const subs=loadSubs();if(subs.some(s=>s.email.toLowerCase()===email.toLowerCase()))return res.status(409).json({error:'Already subscribed'});const sub={id:Date.now().toString(),name,email:email.toLowerCase(),company:company||'',phone:phone||'',industries:industries||'',locations:locations||'',plan:plan||'free',min_price:min_price?Number(min_price):null,max_price:max_price?Number(max_price):null,status:'active',signed_up:new Date().toISOString()};subs.push(sub);saveSubs(subs);res.json({success:true,subscriber:sub})}catch(e){res.status(500).json({error:e.message})}});
router.get('/',(req,res)=>{res.json(loadSubs())});
router.get('/count',(req,res)=>{const s=loadSubs();res.json({total:s.length,free:s.filter(x=>x.plan==='free').length,pro:s.filter(x=>x.plan==='pro').length,enterprise:s.filter(x=>x.plan==='enterprise').length})});
module.exports=router;
