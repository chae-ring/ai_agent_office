import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'office.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS floors (id TEXT PRIMARY KEY, name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE, name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT 'green', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#80c9d5', hair TEXT NOT NULL DEFAULT '#344352', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_documents (agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id), PRIMARY KEY(agent_id, document_id));
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, floor_id TEXT NOT NULL REFERENCES floors(id), department_id TEXT NOT NULL REFERENCES departments(id), agent_id TEXT REFERENCES agents(id), title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS task_documents (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id), PRIMARY KEY(task_id, document_id));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, message TEXT NOT NULL, agent_id TEXT REFERENCES agents(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consultations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, from_agent_id TEXT REFERENCES agents(id), to_agent_id TEXT NOT NULL REFERENCES agents(id), question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, created_at);`);
  if (db.prepare('SELECT COUNT(*) AS n FROM floors').get().n === 0) seed(db);
  return db;
}

export function uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
export function now() { return new Date().toISOString(); }

function seed(db) {
  const f = uid('floor'), d1 = uid('dept'), d2 = uid('dept');
  db.prepare('INSERT INTO floors VALUES (?, ?, ?, ?, ?)').run(f, '3층 · 기획실', '아이디어를 조사하고, 분석하고, 실행 계획으로 만듭니다.', 0, now());
  db.prepare('INSERT INTO departments VALUES (?, ?, ?, ?, ?, ?, ?)').run(d1, f, '리서치 부서', '시장과 사용자의 목소리를 탐색합니다.', 'green', 0, now());
  db.prepare('INSERT INTO departments VALUES (?, ?, ?, ?, ?, ?, ?)').run(d2, f, '콘텐츠 부서', '생각을 읽기 좋은 결과물로 정리합니다.', 'purple', 1, now());
  const add = db.prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run(uid('agent'), d1, '리서처', '자료 조사', '주어진 자료의 출처를 확인하고 사실과 추측을 분리한다.', '#6fcbd7', '#273b54', now());
  add.run(uid('agent'), d1, '분석가', '자료 분석', '자료를 비교하고 근거가 부족한 결론을 명시한다.', '#8095d6', '#514b62', now());
  add.run(uid('agent'), d2, '기획자', '기획 작성', '조사와 분석을 실행 가능한 기획안으로 정리한다.', '#c09ce6', '#514061', now());
}

export function state(db) {
  const floors = db.prepare('SELECT * FROM floors ORDER BY position, created_at').all();
  const deps = db.prepare('SELECT * FROM departments ORDER BY position, created_at').all();
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at').all();
  const agentDocs = db.prepare('SELECT * FROM agent_documents').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  return {floors: floors.map(f => ({...f, departments: deps.filter(d => d.floor_id === f.id).map(d => ({...d, agents: agents.filter(a => a.department_id === d.id).map(a=>({...a,document_ids:agentDocs.filter(x=>x.agent_id===a.id).map(x=>x.document_id)}))})), tasks: tasks.filter(t => t.floor_id === f.id)})), documents: db.prepare('SELECT id,name,mime,size,created_at FROM documents ORDER BY created_at DESC').all()};
}

export function addEvent(db, taskId, type, message, agentId = null) {
  const event = {id:uid('event'), task_id:taskId, type, message, agent_id:agentId, created_at:now()};
  db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)').run(event.id,event.task_id,event.type,event.message,event.agent_id,event.created_at);
  return event;
}

export function taskDetail(db, id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!task) return null;
  return {...task,
    documents: db.prepare('SELECT d.id,d.name,d.mime,d.size FROM documents d JOIN task_documents td ON td.document_id=d.id WHERE td.task_id=?').all(id),
    events: db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY created_at, rowid').all(id),
    consultations: db.prepare('SELECT c.*, a.name AS to_agent_name FROM consultations c LEFT JOIN agents a ON a.id=c.to_agent_id WHERE c.task_id=? ORDER BY c.created_at').all(id)};
}
