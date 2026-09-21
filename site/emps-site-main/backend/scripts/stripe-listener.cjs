// Local test-mode forwarding only. Never print keys or webhook signing secrets.
const {spawn}=require('node:child_process');
function startStripeListener({key,url,onOutput=()=>{},onExit=()=>{}}){
 if(!/^(sk|rk)_test_/.test(key??''))throw Error('Stripe Sandbox test key required');
 const cli=require.resolve('@stripe/cli/bin/shim.js');
 const child=spawn(process.execPath,[cli,'listen','--forward-to',url,'--events','payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,payment_intent.processing','--skip-update'],{env:{...process.env,STRIPE_API_KEY:key},windowsHide:true,stdio:['ignore','pipe','pipe']});
 const ready=new Promise((resolve,reject)=>{
   let pending='';const timer=setTimeout(()=>{child.kill();reject(Error('Stripe CLI readiness timeout'));},45000);
   const read=chunk=>{
    pending+=chunk.toString();const secret=pending.match(/whsec_[A-Za-z0-9]+/);
    if(secret&&/[\s)]/.test(pending.slice(secret.index+secret[0].length,secret.index+secret[0].length+1))){clearTimeout(timer);resolve(secret[0]);}
    const lines=pending.split(/\r?\n/);pending=lines.pop()??'';
    for(const line of lines)onOutput(line.replace(/(?:whsec_|sk_test_|rk_test_)[A-Za-z0-9]+/g,'[REDACTED]'));
   };
   child.stdout.on('data',read);child.stderr.on('data',read);
   child.once('error',()=>{clearTimeout(timer);reject(Error('Stripe CLI could not start'));});
   child.once('exit',code=>{clearTimeout(timer);reject(Error('Stripe CLI exited before readiness'));onExit(code);});
 });
 return {child,ready};
}
module.exports={startStripeListener};
