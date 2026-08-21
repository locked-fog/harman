import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import harmanRemote from '@harman/dsh-bridge/remote'
import styles from './HarmanSection.module.css'

type RecordValue = Record<string, any>
type RemoteFace = {
  snapshot(): Promise<{ ok: boolean; value?: RecordValue; error?: { code: string; message: string } }>
  query(subject: string, input: unknown): Promise<{ ok: boolean; value?: any; error?: { code: string; message: string } }>
  preview(action: string, input: unknown): Promise<{ ok: boolean; value?: RecordValue; error?: { code: string; message: string } }>
  execute(action: string, input: unknown, revision: number, confirmed: boolean): Promise<{ ok: boolean; value?: RecordValue; error?: { code: string; message: string } }>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.harman': 'nav' }
}

// `remote.harman` is created by this plugin's own mount.  Declaring it here
// would make the plugin wait for a service that cannot exist until `apply`
// runs; read the dynamic namespace through `ctx.get()` after mounting instead.
export const inject = ['slots', 'locale', 'remote']

async function unwrap<T>(promise: Promise<{ ok: boolean; value?: T; error?: { code: string; message: string } }>): Promise<T> {
  const response = await promise
  if (!response.ok) throw new Error(`${response.error?.code ?? 'REMOTE_ERROR'}: ${response.error?.message ?? 'request failed'}`)
  return response.value as T
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const remoteContext = ctx as ClientContext & {
    remote: { $mount(face: typeof harmanRemote): Promise<() => Promise<void>> }
  }
  const disposeRemote = await remoteContext.remote.$mount(harmanRemote)
  const remote = ctx.get('remote.harman') as RemoteFace
  const localeDispose = ctx.locale.register('settings.harman', { zh: { nav: 'Harman' }, en: { nav: 'Harman' } })
  const slotDispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'harman', order: 35, label: () => 'Harman',
    inject: () => ({ remote }),
  }, HarmanSection))
  return async () => { slotDispose(); localeDispose(); await disposeRemote() }
}

const NAV = [
  ['overview', 'Overview'], ['packages', 'Packages'], ['resources', 'Resources'],
  ['profiles', 'Profiles'], ['runtime', 'Runtime'], ['repositories', 'Repositories'], ['doctor', 'Diagnostics'],
] as const

function Icon({ kind }: { kind: string }): ReactNode {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    packages: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/></>,
    resources: <><path d="M4 5h16v14H4z"/><path d="M8 2v6M16 2v6M8 16h8"/></>,
    profiles: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    runtime: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
    repositories: <><path d="M3 6h18M5 6v14h14V6M8 3h8v3M9 10h6M9 14h6"/></>,
    doctor: <><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></>,
  }
  return <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>
}

function HarmanSection({ remote }: { remote?: RemoteFace }): ReactNode {
  const [tab, setTab] = useState<(typeof NAV)[number][0]>('overview')
  const [snapshot, setSnapshot] = useState<RecordValue | null>(null)
  const [status, setStatus] = useState<'loading'|'ready'|'offline'|'working'>('loading')
  const [message, setMessage] = useState('Connecting to the local Harman daemon…')
  const [pending, setPending] = useState<{ action: string; input: RecordValue; preview: RecordValue } | null>(null)
  const [inspector, setInspector] = useState<{ title: string; value: unknown } | null>(null)

  async function refresh(announce = true): Promise<void> {
    if (!remote) return
    setStatus('loading')
    try { setSnapshot(await unwrap(remote.snapshot())); setStatus('ready'); if (announce) setMessage('State is current.') }
    catch (error) { setStatus('offline'); if (announce) setMessage(error instanceof Error ? error.message : String(error)) }
  }
  useEffect(() => { void refresh() }, [remote])

  async function plan(action: string, input: RecordValue): Promise<void> {
    if (!remote || !snapshot || status !== 'ready') return
    setStatus('working'); setMessage('Computing impact…')
    try { const preview = await unwrap(remote.preview(action, input)); setPending({ action, input, preview }); setStatus('ready'); setMessage('Review the impact before committing.') }
    catch (error) { setStatus('ready'); setMessage(error instanceof Error ? error.message : String(error)) }
  }
  async function query(subject: string, input: RecordValue, title: string): Promise<void> {
    if (!remote || status !== 'ready') return
    setStatus('working'); setMessage('Loading authoritative data…')
    try { setInspector({ title, value: await unwrap(remote.query(subject, input)) }); setStatus('ready'); setMessage('Query complete.') }
    catch (error) { setStatus('ready'); setMessage(error instanceof Error ? error.message : String(error)) }
  }
  async function commit(): Promise<void> {
    if (!remote || !snapshot || !pending) return
    setStatus('working'); setMessage('Transaction in progress…')
    try {
      const result = await unwrap<RecordValue>(remote.execute(pending.action, pending.input, snapshot.revision, true))
      setSnapshot(result.snapshot); setPending(null); setStatus('ready'); setMessage(`Committed ${pending.action}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPending(null); setStatus('ready'); setMessage(message)
      await refresh(false)
      setMessage(message)
    }
  }

  const active = useMemo(() => snapshot?.profiles?.find((item: RecordValue) => item.active) ?? snapshot?.profiles?.[0], [snapshot])
  const readOnly = status !== 'ready'
  return <div className={styles.shell}>
    <aside className={styles.rail} aria-label="Harman sections">
      <div className={styles.brand}><span className={styles.mark}>H</span><span><strong>Harman</strong><small>Control plane</small></span></div>
      <nav>{NAV.map(([id, label]) => <button key={id} className={tab === id ? styles.selected : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon kind={id}/><span>{label}</span></button>)}</nav>
      <div className={styles.connection}><span className={`${styles.dot} ${styles[status]}`}/><span>{status === 'offline' ? 'Read-only' : status === 'ready' ? 'Daemon ready' : 'Synchronizing'}</span></div>
    </aside>
    <main className={styles.main}>
      <header><div><p className={styles.eyebrow}>Agent environment manager</p><h1>{NAV.find(item => item[0] === tab)?.[1]}</h1></div><button className={styles.secondary} onClick={() => void refresh()} disabled={status === 'working'}>Refresh state</button></header>
      <div className={`${styles.notice} ${status === 'offline' ? styles.danger : ''}`} role="status" aria-live="polite"><span>{message}</span><code>rev {snapshot?.revision ?? '—'}</code></div>
      {snapshot === null ? <Skeleton/> : <Panel tab={tab} snapshot={snapshot} active={active} readOnly={readOnly} plan={plan} query={query}/>} 
      {inspector && <section className={styles.tableCard} aria-live="polite"><div className={styles.tableTitle}><h2>{inspector.title}</h2><button className={styles.textButton} onClick={() => setInspector(null)}>Close</button></div><pre>{JSON.stringify(inspector.value, null, 2)}</pre></section>}
    </main>
    {pending && <div className={styles.backdrop} role="presentation"><div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="impact-title"><p className={styles.eyebrow}>Transaction boundary</p><h2 id="impact-title">Review impact</h2><p>This request is fenced to revision <strong>{pending.preview.expectedRevision}</strong>. Any intervening change will be rejected.</p><pre>{JSON.stringify(pending.preview.impact, null, 2)}</pre><div className={styles.actions}><button className={styles.secondary} onClick={() => setPending(null)}>Cancel</button><button className={styles.primary} onClick={() => void commit()}>Commit transaction</button></div></div></div>}
  </div>
}

function Skeleton(): ReactNode { return <div className={styles.grid} aria-label="Loading Harman"><div className={styles.skeleton}/><div className={styles.skeleton}/><div className={styles.skeleton}/></div> }

function FormAction({ label, placeholder, action, keyName = 'name', disabled, plan }: { label: string; placeholder: string; action: string; keyName?: string; disabled: boolean; plan: (a:string,i:RecordValue)=>Promise<void> }): ReactNode {
  const [value, setValue] = useState('')
  function submit(event: FormEvent) { event.preventDefault(); if (value.trim()) void plan(action, { [keyName]: value.trim(), ...(action === 'profile.create' ? { app: 'web' } : {}) }) }
  return <form className={styles.inlineForm} onSubmit={submit}><label><span className="sr-only">{label}</span><input value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder}/></label><button className={styles.primary} disabled={disabled || !value.trim()}>{label}</button></form>
}

function FieldsAction({ label, action, fields, disabled, plan }: { label:string; action:string; fields:Array<{ name:string; placeholder:string; value?:string }>; disabled:boolean; plan:(a:string,i:RecordValue)=>Promise<void> }): ReactNode {
  const [values, setValues] = useState<RecordValue>(() => Object.fromEntries(fields.map(field => [field.name, field.value ?? ''])))
  function submit(event: FormEvent) { event.preventDefault(); if (fields.every(field => String(values[field.name] ?? '').trim())) void plan(action, values) }
  return <form className={styles.inlineForm} onSubmit={submit}>{fields.map(field => <label key={field.name}><span className="sr-only">{field.placeholder}</span><input value={values[field.name] ?? ''} onChange={event => setValues({ ...values, [field.name]: event.target.value })} placeholder={field.placeholder}/></label>)}<button className={styles.primary} disabled={disabled || !fields.every(field => String(values[field.name] ?? '').trim())}>{label}</button></form>
}

function QueryForm({ label, placeholder, disabled, run }: { label:string; placeholder:string; disabled:boolean; run:(value:string)=>void }): ReactNode {
  const [value, setValue] = useState('')
  return <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); run(value.trim()) }}><label><span className="sr-only">{placeholder}</span><input value={value} onChange={event=>setValue(event.target.value)} placeholder={placeholder}/></label><button className={styles.secondary} disabled={disabled}>{label}</button></form>
}

function Panel({ tab, snapshot, active, readOnly, plan, query }: { tab: string; snapshot: RecordValue; active?: RecordValue; readOnly: boolean; plan:(a:string,i:RecordValue)=>Promise<void>; query:(s:string,i:RecordValue,t:string)=>Promise<void> }): ReactNode {
  if (tab === 'overview') return <><section className={styles.hero}><div><p className={styles.eyebrow}>Current environment</p><h2>{active?.name ?? 'No profile active'}</h2><p>{active ? `${active.app ?? 'headless'} · ${active.runtime?.channel ?? active.runtime?.version}` : 'Create a Profile to begin.'}</p></div><div className={styles.runtimeBadge}><span>DSH Runtime</span><strong>{active?.lastResolvedRuntime?.version ?? active?.latest ?? 'unresolved'}</strong><small>{active?.runtimeStatus ?? 'not configured'}</small></div></section><div className={styles.metrics}>{[['Packages',snapshot.packages.length],['Resources',snapshot.resources.length],['Profiles',snapshot.profiles.length],['Trusted repos',snapshot.repositories.filter((r:RecordValue)=>r.enabled).length]].map(([k,v])=><article key={String(k)}><span>{k}</span><strong>{v}</strong></article>)}</div><List title="Recent audit" rows={snapshot.audit.slice(0,8)} fields={['revision','action','actor']}/></>
  if (tab === 'packages') return <><Toolbar title="Verified packages" subtitle="Installations use repository artifacts; no browser-side npm or pnpm execution."><QueryForm label="Search" placeholder="repository package" disabled={readOnly} run={value=>void query('package.search',{query:value},'Repository search')}/><FormAction label="Preview install" placeholder="package or package@version" action="package.install" keyName="specs" disabled={readOnly} plan={(a,i)=>plan(a,{specs:[i.specs]})}/><button className={styles.secondary} disabled={readOnly} onClick={()=>void plan('package.upgrade',{})}>Preview all upgrades</button></Toolbar><List title={`${snapshot.packages.length} installed`} rows={snapshot.packages} fields={['name','version','reason','source']} actions={row=>[{label:'Remove',run:()=>plan('package.remove',{specs:[row.id]})}]} disabled={readOnly}/></>
  if (tab === 'resources') return <><Toolbar title="Resources and ownership" subtitle="External files remain outside Harman lifecycle control."><FieldsAction label="Bind" action="resource.bind" fields={[{name:'id',placeholder:'resource id'},{name:'profile',placeholder:'profile'}]} disabled={readOnly} plan={plan}/><FieldsAction label="Detach" action="resource.detach" fields={[{name:'id',placeholder:'resource id'},{name:'profile',placeholder:'profile'}]} disabled={readOnly} plan={plan}/></Toolbar><List title={`${snapshot.resources.length} registered`} rows={snapshot.resources} fields={['id','type','ownership','scope','enabled','boundProfiles']} actions={row=>[{label:row.enabled?'Disable':'Enable',run:()=>plan(row.enabled?'resource.disable':'resource.enable',{id:row.id})}]} disabled={readOnly}/></>
  if (tab === 'profiles') return <><Toolbar title="Isolated Profiles" subtitle="Every Profile owns an independent DSH_HOME and reproducible lock."><FormAction label="Create Web profile" placeholder="profile name" action="profile.create" disabled={readOnly} plan={plan}/><FieldsAction label="Clone" action="profile.clone" fields={[{name:'name',placeholder:'source profile'},{name:'nextName',placeholder:'new profile'}]} disabled={readOnly} plan={plan}/><FieldsAction label="Rename" action="profile.rename" fields={[{name:'name',placeholder:'profile'},{name:'nextName',placeholder:'new name'}]} disabled={readOnly} plan={plan}/><FieldsAction label="Export" action="profile.export" fields={[{name:'name',placeholder:'profile'},{name:'destination',placeholder:'server export path'}]} disabled={readOnly} plan={plan}/><FieldsAction label="Restore" action="profile.restore" fields={[{name:'bundle',placeholder:'server bundle path'},{name:'name',placeholder:'new profile name'}]} disabled={readOnly} plan={(a,i)=>plan(a,{...i,mode:'strict'})}/><FieldsAction label="Diff" action="profile.create" fields={[{name:'left',placeholder:'left profile'},{name:'right',placeholder:'right profile'}]} disabled={readOnly} plan={async(_a,i)=>query('profile.diff',i,'Profile diff')}/></Toolbar><List title={`${snapshot.profiles.length} profiles`} rows={snapshot.profiles} fields={['name','app','runtimeStatus','active']} actions={row=>[{label:row.active?'Deactivate':'Activate',run:()=>plan(row.active?'profile.deactivate':'profile.activate',{name:row.name})},{label:'Delete',run:()=>plan('profile.delete',{name:row.name})}]} disabled={readOnly}/></>
  if (tab === 'runtime') return <><Toolbar title="Official DSH Runtime" subtitle="Latest advances only after the compatibility contract passes."><button className={styles.primary} disabled={readOnly} onClick={()=>void plan('runtime.sync',{})}>Check and promote latest</button><FieldsAction label="Pin version" action="profile.runtime" fields={[{name:'name',placeholder:'profile'},{name:'version',placeholder:'exact version'}]} disabled={readOnly} plan={(a,i)=>plan(a,{name:i.name,policy:{version:i.version}})}/><FormAction label="Follow latest" placeholder="profile" action="profile.runtime" disabled={readOnly} plan={(a,i)=>plan(a,{name:i.name,policy:{channel:'latest'}})}/></Toolbar><List title="Runtime channels" rows={snapshot.runtimes} fields={['version','compatibility','official','latest','source']}/></>
  if (tab === 'repositories') return <><Toolbar title="Repository trust" subtitle="Priority, signatures, thresholds and revocation are enforced by Core."><FieldsAction label="Set priority" action="repository.priority" fields={[{name:'id',placeholder:'repository id'},{name:'priority',placeholder:'integer priority'}]} disabled={readOnly} plan={(a,i)=>plan(a,{id:i.id,priority:Number(i.priority)})}/><FieldsAction label="Set policy" action="repository.policy" fields={[{name:'id',placeholder:'repository id'},{name:'policy',placeholder:'trusted-local | hash-only | signed'}]} disabled={readOnly} plan={plan}/></Toolbar><List title={`${snapshot.repositories.length} sources`} rows={snapshot.repositories} fields={['id','priority','trustPolicy','signatureThreshold','enabled']} actions={row=>[{label:row.enabled?'Disable':'Enable',run:()=>plan(row.enabled?'repository.disable':'repository.enable',{id:row.id})}]} disabled={readOnly}/></>
  return <><Toolbar title="Doctor and drift" subtitle="Runtime, materialization and Store links are checked from authoritative state."/><div className={styles.grid}>{snapshot.profiles.map((profile:RecordValue)=><article className={styles.card} key={profile.name}><div className={styles.cardHead}><h3>{profile.name}</h3><span className={profile.doctor?.ok?styles.good:styles.bad}>{profile.doctor?.ok?'Healthy':'Needs attention'}</span></div>{profile.doctor?.checks?.map((check:RecordValue)=><div className={styles.check} key={check.id}><span>{check.id}</span><strong>{check.ok?'Pass':'Fail'}</strong></div>)}</article>)}</div></>
}

function Toolbar({ title, subtitle, children }: { title:string; subtitle:string; children?:ReactNode }): ReactNode { return <section className={styles.toolbar}><div><h2>{title}</h2><p>{subtitle}</p></div>{children}</section> }
function List({ title, rows, fields, actions, disabled }: { title:string; rows:RecordValue[]; fields:string[]; actions?:(row:RecordValue)=>Array<{label:string;run:()=>void}>; disabled?:boolean }): ReactNode { return <section className={styles.tableCard}><div className={styles.tableTitle}><h2>{title}</h2><span>{rows.length} records</span></div><div className={styles.tableWrap}><table><thead><tr>{fields.map(field=><th key={field}>{field}</th>)}{actions&&<th>Actions</th>}</tr></thead><tbody>{rows.length===0?<tr><td colSpan={fields.length+(actions?1:0)} className={styles.empty}>Nothing here yet.</td></tr>:rows.map((row,index)=><tr key={row.id??row.name??index}>{fields.map(field=><td key={field}>{typeof row[field]==='object'?JSON.stringify(row[field]):String(row[field]??'—')}</td>)}{actions&&<td>{actions(row).map(action=><button key={action.label} className={styles.textButton} disabled={disabled} onClick={action.run}>{action.label}</button>)}</td>}</tr>)}</tbody></table></div></section> }
