import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function cli(){if(process.platform!=='win32')return {command:'codex',prefix:[]};for(const dir of (process.env.PATH||'').split(path.delimiter)){const script=path.join(dir,'node_modules','@openai','codex','bin','codex.js');if(fs.existsSync(script))return {command:process.execPath,prefix:[script]}}return {command:'codex',prefix:[]}}
function call(args,options){const binary=cli();return spawnSync(binary.command,[...binary.prefix,...args],options)}
export const leadSchema = {
  type:'object', additionalProperties:false,
  properties:{status:{type:'string',enum:['complete','needs_help','needs_input']},answer:{type:'string'},questions:{type:'array',items:{type:'object',additionalProperties:false,properties:{agent_id:{type:'string'},question:{type:'string'}},required:['agent_id','question']}}},
  required:['status','answer','questions']
};
export const consultationSchema = {type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']};

export function codexStatus() {
  const check=call(['--version'],{encoding:'utf8',timeout:5000});
  const login=!process.env.CODEX_API_KEY&&!process.env.CODEX_ACCESS_TOKEN?call(['login','status'],{encoding:'utf8',timeout:5000}):null;
  const authMode=process.env.CODEX_API_KEY?'api_key':process.env.CODEX_ACCESS_TOKEN?'access_token':login?.status===0?'mounted_login':'missing';
  return {installed:check.status===0,version:(check.stdout||'').trim(),authenticated:check.status===0&&authMode!=='missing',authMode};
}

export function runCodex({prompt,workspace,schema,onProgress,signal,timeoutMs=600000}) {
  return new Promise((resolve,reject)=>{
    fs.mkdirSync(workspace,{recursive:true});
    const schemaPath=path.join(workspace,'output-schema.json');
    const outputPath=path.join(workspace,'final-output.json');
    fs.writeFileSync(schemaPath,JSON.stringify(schema));
    const args=['exec','--json','--ephemeral','--skip-git-repo-check','--sandbox','workspace-write','-c','approval_policy="never"','-c','features.apps=false','-c','shell_environment_policy.inherit="core"','-c','shell_environment_policy.ignore_default_excludes=false','-C',workspace,'--output-schema',schemaPath,'--output-last-message',outputPath,'-'];
    const env=Object.fromEntries(['PATH','Path','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SYSTEMROOT','SystemRoot','TEMP','TMP','CODEX_HOME','CODEX_ACCESS_TOKEN'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    if(process.env.CODEX_API_KEY)env.CODEX_API_KEY=process.env.CODEX_API_KEY;
    const binary=cli();const child=spawn(binary.command,[...binary.prefix,...args],{cwd:workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let settled=false, stdout='', stderr='';
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)};
    const abort=()=>child.kill();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{child.kill();finish(new Error('Codex 작업 제한 시간 초과'))},timeoutMs);
    child.on('error',err=>finish(err));
    child.stdin.on('error',()=>{});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>12000)stderr=stderr.slice(-12000)});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();let ix;while((ix=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,ix);stdout=stdout.slice(ix+1);try{const event=JSON.parse(line);if(event.type==='item.completed'&&event.item?.type==='agent_message')onProgress?.(event.item.text?.slice(0,900)||'Codex 응답 수신');if(event.type==='item.started'&&event.item?.type==='command_execution')onProgress?.('작업 도구 실행 중');if(event.type==='turn.failed')onProgress?.('Codex 실행 실패')}catch{}}});
    child.on('close',code=>{if(signal?.aborted)return finish(new Error('사용자가 작업을 중지했습니다.'));if(code!==0)return finish(new Error(`Codex 종료 코드 ${code}: ${stderr.slice(-900)}`));try{const parsed=JSON.parse(fs.readFileSync(outputPath,'utf8'));finish(null,parsed)}catch(err){finish(new Error(`Codex 결과를 읽지 못했습니다: ${err.message}`))}});
    child.stdin.end(prompt);
  });
}
