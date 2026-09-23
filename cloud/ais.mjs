import {VesselStore, AIS_AREAS, STALE_MS, EXPIRE_MS, STATIC_EXPIRE_MS} from '../lib/vessel-store.mjs';

const POSITION_TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'];
const MESSAGE_TYPES = [...POSITION_TYPES,'ShipStaticData','StaticDataReport'];
const LIMIT_BYTES = 1024 * 1024, ROTATE = 14 * 60_000, SILENCE = 180_000;
const stamp = value => value == null ? null : new Date(value).toISOString();

/** One continuously supervised outbound subscription per collector.
 * Native client WebSockets cannot use Durable Object hibernation or expose pong
 * verification. Silence closes/retries the transport; it never means no traffic.
 */
export class WorkerAisFeed {
  constructor({apiKey,Socket=globalThis.WebSocket,now=Date.now,onEvent=()=>{},schedule=()=>{},random=Math.random}={}) {
    Object.assign(this,{apiKey,Socket,now,onEvent,schedule,random});
    this.store=new VesselStore();this.socket=null;this.connection=apiKey?'idle':'not configured';
    this.lastClientAt=null;this.openedAt=null;this.connectedAt=null;this.lastFrameAt=null;this.lastMessageAt=null;this.lastPositionAt=null;
    this.retryAt=null;this.attempt=0;this.error=null;this.closed=false;this.context={};this.compression=null;
    this.counts={connections:0,reconnects:0,frames:0,decoded:0,positionFrames:0,positionsAccepted:0,staticMessages:0,rejected:0};
  }
  active() { return !!this.apiKey && !this.closed; }
  event(outcome) { try{this.onEvent({outcome,count:this.counts.connections},this.context);}catch{} }
  requestTick() { try{this.schedule();}catch{} }
  connect() {
    if(!this.apiKey || !this.active() || this.socket || this.retryAt !== null && this.now()<this.retryAt)return;
    this.connection='connecting';this.openedAt=this.now();this.connectedAt=null;this.lastFrameAt=null;this.retryAt=null;this.error=null;this.compression=null;
    this.counts.connections++;if(this.counts.connections>1)this.counts.reconnects++;this.event('connecting');
    let socket;try{socket=new this.Socket('wss://stream.aisstream.io/v0/stream');}catch{this.failed();return;}
    this.socket=socket;socket.binaryType='arraybuffer';
    socket.addEventListener('open',()=>{
      if(this.socket!==socket)return;
      try{socket.send(JSON.stringify({APIKey:this.apiKey,BoundingBoxes:AIS_AREAS.map(area=>area.providerBounds),FilterMessageTypes:MESSAGE_TYPES}));}catch{this.failed(socket);}
    });
    socket.addEventListener('message',event=>this.receive(socket,event.data));
    socket.addEventListener('error',()=>{if(this.socket===socket)this.failed(socket);});
    socket.addEventListener('close',()=>{if(this.socket===socket)this.failed(socket);});
    this.requestTick();
  }
  receive(socket, data) {
    if(this.socket!==socket)return;this.counts.frames++;this.lastFrameAt=this.now();
    let message;
    try{
      const bytes=typeof data==='string'?new TextEncoder().encode(data):data instanceof ArrayBuffer?new Uint8Array(data):null;
      if(!bytes || bytes.byteLength>LIMIT_BYTES)throw Error();
      message=JSON.parse(new TextDecoder().decode(bytes));if(!message||typeof message!=='object')throw Error();
    }catch{this.counts.rejected++;return;}
    this.counts.decoded++;
    if(message.error||message.Error||message.MessageType==='Error'){this.error='AISStream rejected access or returned a service error.';this.failed(socket);return;}
    if(message.MessageType==='SubscriptionConfirmation') {
      this.connection='connected';this.connectedAt=this.now();this.compression=message.Message?.CompressionEnabled===true;this.error=null;this.event('connected');return;
    }
    if(POSITION_TYPES.includes(message.MessageType))this.counts.positionFrames++;
    if(message.MetaData&&message.Message)this.lastMessageAt=this.now();
    if(this.store.ingest(message,this.now())){this.lastPositionAt=this.now();this.counts.positionsAccepted++;this.attempt=0;}
    else if(this.store.lastOutcome==='static')this.counts.staticMessages++;else this.counts.rejected++;
  }
  failed(socket=this.socket) {
    if(socket && this.socket!==socket)return;
    this.socket=null;try{socket?.close(1000,'reconnect');}catch{}
    this.connection='disconnected';this.error ||= 'AIS transport unavailable; received positions remain separately dated.';
    this.retryAt=this.active()?this.now()+Math.round(Math.min(300_000,5000*2**Math.min(this.attempt++,6))*(0.8+this.random()*0.2)):null;
    this.event('disconnected');this.requestTick();
  }
  disconnect(status='idle') {
    const socket=this.socket;this.socket=null;this.retryAt=null;this.connection=this.apiKey?status:'not configured';
    try{socket?.close(1000,'view idle');}catch{}
    if(socket)this.event(status);
  }
  tick() {
    this.store.snapshot(this.now());
    if(!this.active()){this.disconnect();return;}
    if(this.socket) {
      const age=this.now()-this.openedAt;
      if(this.connection==='connecting'&&age>=20_000){this.error='AIS subscription confirmation timed out.';this.failed();}
      else if(age>=ROTATE){this.error='AIS transport is rotating; positions retain their original times.';this.failed();}
      else if(this.now()-(this.lastFrameAt??this.openedAt)>=SILENCE){this.error='No AIS frames received recently; transport will retry. This does not establish an empty waterway.';this.failed();}
    }else this.connect();
  }
  nextTick() { return this.apiKey && this.active() ? this.now()+15_000 : null; }
  snapshot({touch=true,context}={}) {
    if(touch){this.lastClientAt=this.now();if(context)this.context=context;this.connect();this.requestTick();}
    this.tick();const now=this.now(),vessels=this.store.snapshot(now),newest=vessels[0];
    return {configured:!!this.apiKey,generatedAt:stamp(now),vessels,areas:AIS_AREAS,staleAfterSeconds:STALE_MS/1000,expiresAfterSeconds:EXPIRE_MS/1000,
      source:{id:'aisstream',name:'AISStream',home:'https://aisstream.io/',configured:!!this.apiKey,connection:this.connection,recordCount:vessels.length,
        frames:this.counts.frames,positionFrames:this.counts.positionFrames,positionsAccepted:this.counts.positionsAccepted,
        retrievedAt:stamp(this.lastPositionAt),latest:newest?.positionTime||null,latestProviderPositionAt:vessels.map(v=>v.sourceAt).filter(Boolean).sort().at(-1)||null,
        timestampBasis:newest?.timestampBasis||null,connectedAt:stamp(this.connectedAt),lastFrameAt:stamp(this.lastFrameAt),lastMessageAt:stamp(this.lastMessageAt),lastPositionReceivedAt:stamp(this.lastPositionAt),
        nextRetryAt:stamp(this.retryAt),error:this.error,interval:10,compression:this.compression,heartbeat:'Not exposed by Worker client WebSocket; position age uses original timestamps',
        access:'Background outbound connection; reconnects and coverage gaps possible',freshness:!newest?'unknown':newest.stale?'stale':'current'}};
  }
  checkpoint() {
    this.store.snapshot(this.now());
    return {schema:1,vessels:[...this.store.vessels.values()],static:[...this.store.static],lastPositionAt:stamp(this.lastPositionAt)};
  }
  restore(value) {
    if(value?.schema!==1 || !Array.isArray(value.vessels) || !Array.isArray(value.static))return;
    const now=this.now(),validTime=(time,maxAge)=>typeof time==='string'&&Number.isFinite(Date.parse(time))&&Date.parse(time)<=now+60_000&&now-Date.parse(time)<maxAge;
    // Revalidate persisted positions through the same provider parser. Restoring
    // a receipt-dated point must never turn its old receipt into a new position.
    for(const v of value.vessels.slice(-this.store.limit)) {
      if(typeof v?.mmsi!=='string'||!/^([1-9]\d{8})$/.test(v.mmsi)||!validTime(v.positionTime,EXPIRE_MS)||!validTime(v.receivedAt,EXPIRE_MS)||!['provider','received'].includes(v.timestampBasis))continue;
      if(v.timestampBasis==='provider'&&v.sourceAt!==v.positionTime)continue;
      if(v.timestampBasis==='received'&&(v.sourceAt!==null||v.positionTime!==v.receivedAt))continue;
      const envelope={MessageType:'PositionReport',MetaData:{MMSI:v.mmsi,ShipName:v.name,time_utc:v.positionTime},Message:{PositionReport:{Latitude:v.latitude,Longitude:v.longitude,Sog:v.speedKnots,Cog:v.courseDegrees,TrueHeading:v.headingDegrees}}};
      if(this.store.ingest(envelope,now))Object.assign(this.store.vessels.get(v.mmsi),{receivedAt:v.receivedAt,sourceAt:v.sourceAt,timestampBasis:v.timestampBasis,timestampNote:v.timestampBasis==='received'?'Provider time unavailable in retained position; age uses original receipt time.':null});
    }
    for(const pair of value.static.slice(-this.store.limit)) {
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!/^([1-9]\d{8})$/.test(pair[0])||typeof pair[1]!=='object'||!pair[1])continue;
      const [id,info]=pair,restored={};
      if(validTime(info.nameAt,STATIC_EXPIRE_MS)&&typeof info.name==='string'){restored.name=info.name.replace(/[@\x00-\x1f]/g,'').trim().slice(0,80);restored.nameAt=info.nameAt;}
      if(validTime(info.shipTypeObservedAt,STATIC_EXPIRE_MS)&&(info.shipTypeCode===null||Number.isInteger(info.shipTypeCode)&&info.shipTypeCode>=0&&info.shipTypeCode<=99)&&['provider','received'].includes(info.shipTypeTimestampBasis)&&MESSAGE_TYPES.includes(info.shipTypeMessage)) {
        for(const key of ['shipTypeCode','shipTypeObservedAt','shipTypeTimestampBasis','shipTypeMessage'])restored[key]=info[key];
      }
      if(restored.nameAt||restored.shipTypeObservedAt)this.store.static.set(id,restored);
    }
    this.lastPositionAt=validTime(value.lastPositionAt,EXPIRE_MS)?Date.parse(value.lastPositionAt):null;
    this.store.snapshot(now);
  }
  diagnostics() { return {counts:structuredClone(this.counts),...this.snapshot({touch:false}).source}; }
  close() { this.closed=true;this.disconnect('disconnected'); }
}
