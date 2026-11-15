import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {uid,now,addEvent} from './db.js';
import {runCodex,leadSchema,consultationSchema,codexStatus} from './codex.js';

export function createWorker(db,dataDir,broadcast,runner=runCodex) {
  const active=new Map();let busy=false;
  function emit(taskId,type,message,agentId=null){const event=addEvent(db,taskId,type,message,agentId);broadcast({kind:'event',event});return event}
  async function runTask(task) {
    const controller=new AbortController();active.set(task.id,controller);
    try{
    const workspace=path.join(dataDir,'jobs',task.id);
    fs.mkdirSync(workspace,{recursive:true});
    function agentWorkspace(agentId){const dir=path.join(workspace,agentId);fs.mkdirSync(dir,{recursive:true});return dir}
    const docs=db.prepare('SELECT d.* FROM documents d JOIN task_documents td ON td.document_id=d.id WHERE td.task_id=?').all(task.id);
    const materialized=new Map();
    function materialize(doc,agentId){const key=`${agentId}:${doc.id}`;if(materialized.has(key))return materialized.get(key);const source=path.join(dataDir,'documents',doc.storage_name);const target=path.join(agentWorkspace(agentId),`${doc.id}-${path.basename(doc.name).replace(/[^\p{L}\p{N}._-]/gu,'_')}`);fs.copyFileSync(source,target);let readable=target;
      if(/\.pdf$/i.test(doc.name)){readable=target+'.txt';const out=spawnSync('pdftotext',['-layout',target,readable],{encoding:'utf8',timeout:30000});if(out.status!==0)throw new Error(`PDF 문서 ${doc.name}의 텍스트를 추출하지 못했습니다.`)}
      if(/\.docx$/i.test(doc.name)){readable=target+'.txt';const out=spawnSync('unzip',['-p',target,'word/document.xml'],{encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024});if(out.status!==0)throw new Error(`DOCX 문서 ${doc.name}의 텍스트를 추출하지 못했습니다.`);const text=out.stdout.replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');fs.writeFileSync(readable,text)}
      materialized.set(key,`${doc.name}: ${readable}`);return materialized.get(key)}
    function documentLines(agentId){const own=db.prepare('SELECT d.* FROM documents d JOIN agent_documents ad ON ad.document_id=d.id WHERE ad.agent_id=?').all(agentId);return [...new Map([...docs,...own].map(doc=>[doc.id,doc])).values()].map(doc=>materialize(doc,agentId))}
    const agents=db.prepare('SELECT a.*,d.name AS department_name,d.purpose AS department_purpose,f.name AS floor_name,f.purpose AS floor_purpose FROM agents a JOIN departments d ON d.id=a.department_id JOIN floors f ON f.id=d.floor_id WHERE f.id=?').all(task.floor_id);
    const lead=agents.find(a=>a.id===task.agent_id)||agents.find(a=>a.department_id===task.department_id);
    if(!lead)throw new Error('담당 부서에 에이전트가 없습니다. 먼저 에이전트를 추가하세요.');
    const leadDocLines=documentLines(lead.id);
    const colleagues=agents.filter(a=>a.id!==lead.id).map(a=>`${a.id}: ${a.name} (${a.role}, ${a.department_name})`).join('\n')||'없음';
    const base=`당신은 AI 사무실의 ${lead.name}입니다. 역할: ${lead.role}.\n현재 층: ${lead.floor_name}. 층의 용도와 작업 기준: ${lead.floor_purpose||'별도 기준 없음'}\n소속 부서: ${lead.department_name}. 부서의 역할과 작업 기준: ${lead.department_purpose||'별도 기준 없음'}\n역할 지침: ${lead.instructions||'사용자가 지정한 업무를 정확히 수행한다.'}\n사용자 업무: ${task.title}\n상세 지시: ${task.instructions||'없음'}\n당신에게 허용된 업무·전문 문서:\n${leadDocLines.join('\n')||'없음'}\n협업 가능한 동료:\n${colleagues}\n층 용도, 부서 역할, 역할 지침을 업무 방식에 반영하세요. 문서는 실제 파일을 확인하고 근거를 밝히세요. 정보가 부족하면 추측으로 채우지 말고 needs_input으로 답하세요. 동료가 알 가능성이 있는 구체적 질문만 needs_help로 요청하세요. 동료의 agent_id는 목록에 있는 ID만 사용하세요. 질문은 최대 2개로 제한합니다. 완료했다면 answer에 최종 결과를 적으세요. JSON 스키마에 맞춰 답하세요.`;
      db.prepare('UPDATE tasks SET status=?,started_at=?,error=? WHERE id=?').run('running',now(),'',task.id);broadcast({kind:'task',taskId:task.id,status:'running'});emit(task.id,'started',`${lead.name} 에이전트가 업무를 시작했습니다.`,lead.id);
      let result=await runner({prompt:base,workspace:agentWorkspace(lead.id),schema:leadSchema,signal:controller.signal,onProgress:m=>emit(task.id,'progress',m,lead.id)});
      if(result.status==='needs_help'&&Array.isArray(result.questions)&&result.questions.length){
        const answers=[];const requests=result.questions.slice(0,2).filter(q=>agents.some(a=>a.id===q.agent_id&&a.id!==lead.id));
        if(requests.length>1)emit(task.id,'meeting',`${lead.name}과 동료 ${requests.length}명이 자료를 검토하는 회의를 시작했습니다.`,lead.id);
        for(const q of requests){const specialist=agents.find(a=>a.id===q.agent_id);emit(task.id,'consultation',`${lead.name} → ${specialist.name}: ${q.question}`,specialist.id);
          const response=await runner({prompt:`당신은 ${specialist.name}입니다. 역할: ${specialist.role}. 지침: ${specialist.instructions||'정확히 답한다.'}\n현재 층: ${specialist.floor_name}. 층의 용도: ${specialist.floor_purpose||'별도 기준 없음'}\n소속 부서: ${specialist.department_name}. 부서의 역할: ${specialist.department_purpose||'별도 기준 없음'}\n층 용도와 부서 역할을 답변에 반영하세요.\n동료 ${lead.name}의 질문: ${q.question}\n원래 업무: ${task.title}\n당신에게 허용된 업무·전문 문서:\n${documentLines(specialist.id).join('\n')||'없음'}\n파일을 실제로 확인하고, 모르면 모른다고 답하세요. JSON 스키마에 맞춰 answer를 작성하세요.`,workspace:agentWorkspace(specialist.id),schema:consultationSchema,signal:controller.signal,onProgress:m=>emit(task.id,'progress',m,specialist.id)});
          db.prepare('INSERT INTO consultations VALUES (?,?,?,?,?,?,?)').run(uid('consult'),task.id,lead.id,specialist.id,q.question,response.answer||'',now());answers.push(`${specialist.name} 답변: ${response.answer||''}`);emit(task.id,'consultation_answer',`${specialist.name}이(가) 답변을 전달했습니다.`,specialist.id)}
        if(answers.length){
          if(answers.length>1){const shared=answers.join('\n\n');for(const q of requests){const specialist=agents.find(a=>a.id===q.agent_id);const review=await runner({prompt:`당신은 ${specialist.name}입니다. 원래 질문: ${q.question}\n회의 참여자들이 공유한 답변:\n${shared}\n다른 동료의 의견을 읽고 수정하거나 보완할 점을 답하세요. 근거가 없으면 없다고 말하세요. JSON 스키마의 answer로 답하세요.`,workspace:agentWorkspace(specialist.id),schema:consultationSchema,signal:controller.signal,onProgress:m=>emit(task.id,'progress',m,specialist.id)});const note=`${specialist.name} 회의 검토: ${review.answer||''}`;answers.push(note);db.prepare('INSERT INTO consultations VALUES (?,?,?,?,?,?,?)').run(uid('consult'),task.id,lead.id,specialist.id,'공유된 회의 답변 검토',review.answer||'',now());emit(task.id,'meeting_review',`${specialist.name}이(가) 동료 의견을 검토했습니다.`,specialist.id)}emit(task.id,'meeting_summary','회의 답변을 취합해 담당 에이전트에게 전달했습니다.',lead.id)}
          result=await runner({prompt:`${base}\n\n동료와의 협업 결과:\n${answers.join('\n\n')}\n이 답변을 검토하여 최종 결과를 작성하세요. 추가 정보가 꼭 필요하면 needs_input으로 답하세요.`,workspace:agentWorkspace(lead.id),schema:leadSchema,signal:controller.signal,onProgress:m=>emit(task.id,'progress',m,lead.id)})}
      }
      if(result.status==='needs_input'||result.status==='needs_help'){db.prepare('UPDATE tasks SET status=?,result=?,completed_at=? WHERE id=?').run('needs_input',result.answer||'추가 자료가 필요합니다.',now(),task.id);emit(task.id,'needs_input',result.answer||'추가 자료가 필요합니다.',lead.id);broadcast({kind:'task',taskId:task.id,status:'needs_input'})}
      else{db.prepare('UPDATE tasks SET status=?,result=?,completed_at=? WHERE id=?').run('completed',result.answer||'',now(),task.id);emit(task.id,'completed',`${lead.name}이(가) 업무를 완료했습니다.`,lead.id);broadcast({kind:'task',taskId:task.id,status:'completed'})}
    }catch(err){const stopped=controller.signal.aborted;db.prepare('UPDATE tasks SET status=?,error=?,completed_at=? WHERE id=?').run(stopped?'cancelled':'failed',err.message,now(),task.id);emit(task.id,stopped?'cancelled':'failed',err.message);broadcast({kind:'task',taskId:task.id,status:stopped?'cancelled':'failed'})}
    finally{active.delete(task.id)}
  }
  async function pump(){if(busy)return;if(runner===runCodex&&!codexStatus().authenticated)return;busy=true;try{let task;while((task=db.prepare("SELECT * FROM tasks WHERE status='queued' ORDER BY created_at LIMIT 1").get()))await runTask(task)}finally{busy=false}}
  function enqueue(){setImmediate(pump)}
  function stop(id){const controller=active.get(id);if(controller){controller.abort();return true}const t=db.prepare('SELECT status FROM tasks WHERE id=?').get(id);if(t?.status==='queued'){db.prepare("UPDATE tasks SET status='cancelled',completed_at=? WHERE id=?").run(now(),id);emit(id,'cancelled','사용자가 대기 중인 업무를 취소했습니다.');broadcast({kind:'task',taskId:id,status:'cancelled'});return true}return false}
  db.prepare("UPDATE tasks SET status='queued' WHERE status='running'").run();enqueue();
  return {enqueue,stop,active};
}
