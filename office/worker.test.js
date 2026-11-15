import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,uid,now,taskDetail} from './db.js';
import {createWorker} from './worker.js';

test('담당 Codex가 동료에게 질문하고 답을 받아 업무를 완료한다',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-office-test-'));
  const db=openDatabase(dir);
  try{
    const floor=db.prepare('SELECT * FROM floors LIMIT 1').get();
    const agents=db.prepare('SELECT * FROM agents ORDER BY created_at').all();
    const lead=agents[0],colleague=agents[1],taskId=uid('task'),docId=uid('doc'),specialistDocId=uid('doc');
    db.prepare('UPDATE floors SET purpose=? WHERE id=?').run('신뢰할 수 있는 시장 근거를 조사한다',floor.id);
    db.prepare('UPDATE departments SET purpose=? WHERE id=?').run('시장 규모와 경쟁사를 검증한다',lead.department_id);
    fs.mkdirSync(path.join(dir,'documents'));
    fs.writeFileSync(path.join(dir,'documents',`${docId}.txt`),'시장 규모: 120억 원');
    db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(docId,'시장자료.txt','text/plain',24,`${docId}.txt`,now());
    fs.writeFileSync(path.join(dir,'documents',`${specialistDocId}.txt`),'내부 분석 메모');
    db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?)').run(specialistDocId,'분석가메모.txt','text/plain',24,`${specialistDocId}.txt`,now());
    db.prepare('INSERT INTO agent_documents VALUES (?,?)').run(colleague.id,specialistDocId);
    db.prepare('INSERT INTO tasks (id,floor_id,department_id,agent_id,title,instructions,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(taskId,floor.id,lead.department_id,lead.id,'시장 조사','첨부 자료를 기반으로 정리','queued',now());
    db.prepare('INSERT INTO task_documents VALUES (?,?)').run(taskId,docId);
    const calls=[];
    const fakeRunner=async input=>{calls.push(input);if(calls.length===1)return {status:'needs_help',answer:'',questions:[{agent_id:colleague.id,question:'시장 규모를 어떻게 해석할까요?'}]};if(calls.length===2)return {answer:'시장 규모는 120억 원입니다.'};return {status:'complete',answer:'시장 규모는 120억 원입니다. 자료와 분석가의 답을 확인했습니다.',questions:[]}};
    createWorker(db,dir,()=>{},fakeRunner);
    const deadline=Date.now()+3000;
    while(Date.now()<deadline&&db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId).status!=='completed')await new Promise(r=>setTimeout(r,20));
    const detail=taskDetail(db,taskId);
    assert.equal(detail.status,'completed');
    assert.equal(detail.consultations.length,1);
    assert.match(detail.consultations[0].answer,/120억/);
    assert.match(detail.result,/120억/);
    assert.equal(calls.length,3);
    assert.match(calls[0].prompt,/시장자료.txt/);
    assert.match(calls[0].prompt,/신뢰할 수 있는 시장 근거를 조사한다/);
    assert.match(calls[0].prompt,/시장 규모와 경쟁사를 검증한다/);
    assert.doesNotMatch(calls[0].prompt,/분석가메모.txt/);
    assert.match(calls[1].prompt,/분석가메모.txt/);
    assert.match(calls[1].prompt,/신뢰할 수 있는 시장 근거를 조사한다/);
    assert.notEqual(calls[0].workspace,calls[1].workspace);
    assert.ok(detail.events.some(e=>e.type==='consultation_answer'));
  }finally{db.close();if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(dir,{recursive:true,force:true})}
});

test('여러 동료가 서로의 답을 검토하는 회의를 기록한다',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-office-meeting-'));
  const db=openDatabase(dir);
  try{
    const floor=db.prepare('SELECT * FROM floors LIMIT 1').get(),agents=db.prepare('SELECT * FROM agents ORDER BY created_at').all(),lead=agents[0],taskId=uid('task');
    db.prepare('INSERT INTO tasks (id,floor_id,department_id,agent_id,title,instructions,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(taskId,floor.id,lead.department_id,lead.id,'기획 검토','팀 의견을 종합','queued',now());
    const calls=[];const fakeRunner=async input=>{calls.push(input);switch(calls.length){case 1:return {status:'needs_help',answer:'',questions:[{agent_id:agents[1].id,question:'자료를 분석해줘'},{agent_id:agents[2].id,question:'기획을 평가해줘'}]};case 2:return {answer:'분석 의견 A'};case 3:return {answer:'기획 의견 B'};case 4:return {answer:'B를 보고 A를 수정'};case 5:return {answer:'A를 보고 B를 보완'};default:return {status:'complete',answer:'회의 결론',questions:[]}}};
    createWorker(db,dir,()=>{},fakeRunner);
    const deadline=Date.now()+3000;while(Date.now()<deadline&&db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId).status!=='completed')await new Promise(r=>setTimeout(r,20));
    const detail=taskDetail(db,taskId);assert.equal(detail.status,'completed');assert.equal(detail.consultations.length,4);assert.ok(detail.events.some(e=>e.type==='meeting_summary'));assert.match(calls[3].prompt,/기획 의견 B/);assert.match(calls[5].prompt,/B를 보완/);
  }finally{db.close();if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(dir,{recursive:true,force:true})}
});
