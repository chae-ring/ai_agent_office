const reportEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function reportText(markdown){
  const inline=value=>value.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
  return reportEsc(markdown||'결과 내용이 없습니다.').split(/\n\s*\n/).map(block=>{
    const lines=block.split('\n');
    if(lines.every(line=>/^\s*[-*]\s+/.test(line)))return `<ul>${lines.map(line=>`<li>${inline(line.replace(/^\s*[-*]\s+/,''))}</li>`).join('')}</ul>`;
    const heading=block.match(/^(#{1,3})\s+(.+)$/);
    if(heading){const level=Math.min(4,Number(heading[1].length)+1);return `<h${level}>${inline(heading[2])}</h${level}>`}
    return `<p>${inline(block).replace(/\n/g,'<br>')}</p>`;
  }).join('');
}

function reportMarkdown(task,office,artifacts){
  const floor=office.floors.find(item=>item.id===task.floor_id);
  const department=floor?.departments.find(item=>item.id===task.department_id);
  const agent=department?.agents.find(item=>item.id===task.agent_id);
  const date=task.completed_at?new Date(task.completed_at).toLocaleString('ko-KR'):'-';
  return [
    `# ${task.title}`,
    `- 완료 일시: ${date}`,
    `- 층 / 부서: ${floor?.name||'-'} / ${department?.name||'-'}`,
    `- 담당 에이전트: ${agent?.name||'-'}${agent?.role?` (${agent.role})`:''}`,
    '', '## 요청 내용', task.instructions||'요청 내용 없음',
    '', '## 결과', task.result||'결과 내용이 없습니다.',
    ...(task.consultations.length?['','## 에이전트 협업',...task.consultations.flatMap(item=>[`### ${item.to_agent_name||'협업 에이전트'}`,`질문: ${item.question}`,`답변: ${item.answer}`,''])]:[]),
    ...(task.documents.length?['','## 참고 문서',...task.documents.map(item=>`- ${item.name}`)]:[]),
    ...(artifacts.length?['','## 생성 파일',...artifacts.map(item=>`- ${item.path}`)]:[])
  ].join('\n');
}

async function showTaskReport(taskId){
  const [task,office,artifacts]=await Promise.all([
    fetch(`/api/tasks/${encodeURIComponent(taskId)}`).then(response=>{if(!response.ok)throw new Error('보고서를 불러오지 못했습니다.');return response.json()}),
    fetch('/api/state').then(response=>response.json()),
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`).then(response=>response.json())
  ]);
  const floor=office.floors.find(item=>item.id===task.floor_id);
  const department=floor?.departments.find(item=>item.id===task.department_id);
  const agent=department?.agents.find(item=>item.id===task.agent_id);
  const started=task.started_at?new Date(task.started_at).getTime():0;
  const completed=task.completed_at?new Date(task.completed_at).getTime():0;
  const elapsed=started&&completed?Math.max(1,Math.round((completed-started)/60000))+'분':'기록 없음';
  const overlay=document.createElement('div');
  overlay.className='report-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','완료 업무 보고서');
  overlay.innerHTML=`<article class="report-sheet">
    <header class="report-toolbar"><div><span class="report-check">✓</span><span>완료 업무 보고서</span></div><div class="report-actions"><button class="outline" data-report-download>보고서 다운로드</button><button class="outline" data-report-print>인쇄 / PDF</button><button class="report-close" aria-label="닫기">×</button></div></header>
    <div class="report-content">
      <div class="report-eyebrow">AGENT OFFICE · COMPLETION REPORT</div>
      <h1>${reportEsc(task.title)}</h1>
      <p class="report-lede">에이전트가 완료한 업무와 결과를 정리한 보고서입니다.</p>
      <div class="report-meta"><div><small>완료 일시</small><b>${completed?reportEsc(new Date(completed).toLocaleString('ko-KR')):'-'}</b></div><div><small>담당 층 · 부서</small><b>${reportEsc(floor?.name||'-')} · ${reportEsc(department?.name||'-')}</b></div><div><small>담당 에이전트</small><b>${reportEsc(agent?.name||'-')}${agent?.role?` · ${reportEsc(agent.role)}`:''}</b></div><div><small>처리 시간</small><b>${elapsed}</b></div></div>
      <section class="report-section report-result"><div class="report-section-label">RESULT</div><h2>업무 결과</h2><div class="report-prose">${reportText(task.result)}</div></section>
      <section class="report-section"><div class="report-section-label">REQUEST</div><h2>요청 내용</h2><div class="report-request">${reportText(task.instructions||'요청 내용이 없습니다.')}</div></section>
      ${task.consultations.length?`<section class="report-section"><div class="report-section-label">COLLABORATION</div><h2>협업 에이전트 작업 <span class="report-count">${task.consultations.length}</span></h2><div class="report-collaborators">${task.consultations.map(item=>`<article><b>${reportEsc(item.to_agent_name||'협업 에이전트')}</b><div class="report-question"><strong>질문</strong>${reportText(item.question)}</div><div><strong>답변</strong>${reportText(item.answer)}</div></article>`).join('')}</div></section>`:''}
      ${task.documents.length?`<section class="report-section"><div class="report-section-label">SOURCES</div><h2>참고 문서</h2><div class="report-files">${task.documents.map(item=>`<a href="/api/documents/${encodeURIComponent(item.id)}">▤ ${reportEsc(item.name)} <span>다운로드</span></a>`).join('')}</div></section>`:''}
      ${artifacts.length?`<section class="report-section"><div class="report-section-label">DELIVERABLES</div><h2>생성 파일 <span class="report-count">${artifacts.length}</span></h2><div class="report-files">${artifacts.map(item=>`<a href="/api/tasks/${encodeURIComponent(task.id)}/artifacts/${encodeURIComponent(item.path)}">▤ ${reportEsc(item.path)} <span>${Math.max(1,Math.round(item.size/1024))} KB 다운로드</span></a>`).join('')}</div></section>`:''}
      <footer class="report-footer">Agent Office · 업무 기록 ${reportEsc(task.id)}</footer>
    </div>
  </article>`;
  document.body.append(overlay);
  const escapeReport=event=>{if(event.key==='Escape')close()};
  const close=()=>{overlay.remove();document.removeEventListener('keydown',escapeReport)};
  overlay.querySelector('.report-close').addEventListener('click',close);
  overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
  overlay.querySelector('[data-report-download]').addEventListener('click',()=>{
    const blob=new Blob([reportMarkdown(task,office,artifacts)],{type:'text/markdown;charset=utf-8'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${task.title.replace(/[\\/:*?"<>|]/g,'_')}-report.md`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  });
  overlay.querySelector('[data-report-print]').addEventListener('click',()=>window.print());
  document.addEventListener('keydown',escapeReport);
  overlay.querySelector('.report-close').focus();
}

document.addEventListener('click',event=>{
  const taskRow=event.target.closest('[data-task][data-status="completed"]');
  if(!taskRow)return;
  event.preventDefault();event.stopImmediatePropagation();
  showTaskReport(taskRow.dataset.task).catch(error=>window.alert(error.message));
},true);
