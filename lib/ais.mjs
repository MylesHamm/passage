import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {VesselStore, AIS_AREAS, EXPIRE_MS, STALE_MS, SUBSCRIPTION_TYPES, TYPES} from './vessel-store.mjs';
export {VesselStore, AIS_AREAS, EXPIRE_MS, STALE_MS, STATIC_EXPIRE_MS} from './vessel-store.mjs';

export class AisFeed {
  constructor({apiKey,Socket=WebSocket,now=Date.now,idleMs=90000,pingMs=30000,pongMs=15000,random=Math.random,onEvent=()=>{}}={}) {
    Object.assign(this,{apiKey,Socket,now,idleMs,pingMs,pongMs,random,onEvent});
    this.store=new VesselStore();this.connection=apiKey?'idle':'not configured';this.socket=null;this.lastClientAt=0;this.attempt=0;this.retryAt=null;this.closed=false;
    this.connectedAt=null;this.lastMessageAt=null;this.lastPositionAt=null;this.lastFrameAt=null;this.lastHeartbeatAt=null;this.lastPongAt=null;this.pingSentAt=null;this.pingToken=null;this.nextPingAt=null;this.compression=null;this.error=null;this.context={};
    this.counts={connections:0,reconnects:0,heartbeats:0,heartbeatTimeouts:0,frames:0,decoded:0,positionFrames:0,positionsAccepted:0,receiptTimeFallbacks:0,staticMessages:0,rejected:{json:0,invalid_message:0,identity:0,coordinates:0,expired:0,out_of_order:0,outside_area:0,unsupported:0}};
    this.maintenance=setInterval(()=>this.tick(),5000);this.maintenance.unref();
  }
  event(outcome){try{this.onEvent({outcome,count:this.counts.connections},this.context);}catch{}}
  tick(){
    const now=this.now();this.store.snapshot(now);
    if(this.socket&&now-this.lastClientAt>this.idleMs){this.disconnect('idle');return;}
    if(!this.socket){if(this.retryAt!==null&&now>=this.retryAt&&now-this.lastClientAt<=this.idleMs)this.connect();return;}
    if(this.connection==='connecting'&&now>=this.confirmBy){this.error='AIS subscription confirmation timed out.';this.socket.terminate();return;}
    if(this.connection!=='connected')return;
    if(this.pingSentAt!==null&&now-this.pingSentAt>=this.pongMs){this.error='AIS heartbeat timed out; reconnecting while the view is open.';this.counts.heartbeatTimeouts++;this.event('heartbeat_timeout');this.socket.terminate();return;}
    if(this.pingSentAt===null&&now>=this.nextPingAt){
      this.pingSentAt=now;this.pingToken=randomUUID();const socket=this.socket;
      try{socket.ping(this.pingToken,error=>{if(error&&this.socket===socket)socket.terminate();});}catch{if(this.socket===socket)socket.terminate();}
    }
  }
  connect(){
    if(!this.apiKey||this.socket||this.closed||(this.retryAt!==null&&this.now()<this.retryAt))return;
    this.retryAt=null;this.connection='connecting';this.error=null;this.compression=null;this.connectedAt=null;this.lastHeartbeatAt=null;this.lastPongAt=null;this.pingSentAt=null;this.pingToken=null;
    this.context={...this.context,operationId:randomUUID()};this.counts.connections++;if(this.counts.connections>1)this.counts.reconnects++;this.event('connecting');
    // Backend subscription, binary JSON, compression and focused bounding boxes:
    // https://aisstream.io/documentation
    const socket=new this.Socket('wss://stream.aisstream.io/v0/stream',{perMessageDeflate:true,handshakeTimeout:15000,maxPayload:1024*1024});
    this.socket=socket;this.confirmBy=this.now()+20000;
    socket.on('open',()=>{if(this.socket===socket)socket.send(JSON.stringify({APIKey:this.apiKey,BoundingBoxes:AIS_AREAS.map(a=>a.providerBounds),FilterMessageTypes:[...SUBSCRIPTION_TYPES]}));});
    socket.on('ping',()=>{if(this.socket===socket)this.lastHeartbeatAt=new Date(this.now()).toISOString();}); // ws automatically replies.
    socket.on('pong',buffer=>{
      if(this.socket!==socket||this.pingToken===null||buffer.toString()!==this.pingToken)return;
      this.lastPongAt=this.lastHeartbeatAt=new Date(this.now()).toISOString();this.pingSentAt=null;this.pingToken=null;this.nextPingAt=this.now()+this.pingMs;this.attempt=0;this.counts.heartbeats++;
    });
    socket.on('message',buffer=>{
      if(this.socket!==socket)return;this.counts.frames++;this.lastFrameAt=new Date(this.now()).toISOString();
      let message;try{message=JSON.parse(buffer.toString());}catch{this.counts.rejected.json++;return;}
      if(!message||typeof message!=='object'){this.counts.rejected.invalid_message++;return;}this.counts.decoded++;
      if(message.error||message.Error||message.MessageType==='Error'){this.error='AISStream rejected access or reported a service error. Check local configuration and connection limits.';socket.terminate();return;}
      if(message.MessageType==='SubscriptionConfirmation'){
        this.connection='connected';this.connectedAt=new Date(this.now()).toISOString();this.compression=message.Message?.CompressionEnabled===true;this.error=null;this.nextPingAt=this.now()+this.pingMs;this.event('connected');return;
      }
      if(TYPES.includes(message.MessageType))this.counts.positionFrames++;
      if(message.MetaData&&message.Message)this.lastMessageAt=new Date(this.now()).toISOString();
      if(this.store.ingest(message,this.now())){this.lastPositionAt=new Date(this.now()).toISOString();this.counts.positionsAccepted++;if(this.store.lastOutcome==='accepted_receipt_time')this.counts.receiptTimeFallbacks++;}
      else if(this.store.lastOutcome==='static')this.counts.staticMessages++;
      else if(Object.hasOwn(this.counts.rejected,this.store.lastOutcome))this.counts.rejected[this.store.lastOutcome]++;
    });
    socket.on('error',()=>{if(this.socket===socket)this.error='AIS connection failed; retrying while the view is open.';});
    socket.on('close',()=>{
      if(this.socket!==socket)return;this.socket=null;this.connection='disconnected';this.pingSentAt=null;this.pingToken=null;
      if(!this.error)this.error='AIS disconnected; retrying while the view is open.';
      if(!this.closed&&this.now()-this.lastClientAt<=this.idleMs)this.retryAt=this.now()+Math.min(60000,2000*2**Math.min(this.attempt++,5))+this.random()*1000;
      this.event('disconnected');
    });
  }
  snapshot({touch=true,context}={}){
    const now=this.now();if(touch){this.lastClientAt=now;if(context)this.context={...this.context,...context};this.connect();}
    const vessels=this.store.snapshot(now),newest=vessels[0],latestProviderPositionAt=vessels.map(v=>v.sourceAt).filter(Boolean).sort().at(-1)||null;
    return {configured:!!this.apiKey,generatedAt:new Date(now).toISOString(),vessels,areas:AIS_AREAS,
      source:{id:'aisstream',name:'AISStream',home:'https://aisstream.io/',configured:!!this.apiKey,connection:this.connection,recordCount:vessels.length,
        frames:this.counts.frames,positionFrames:this.counts.positionFrames,positionsAccepted:this.counts.positionsAccepted,
        retrievedAt:this.lastPositionAt,latest:newest?.sourceAt||null,latestProviderPositionAt,timestampBasis:newest?.timestampBasis||null,
        connectedAt:this.connectedAt,lastFrameAt:this.lastFrameAt,lastMessageAt:this.lastMessageAt,lastPositionReceivedAt:this.lastPositionAt,lastHeartbeatAt:this.lastHeartbeatAt,lastPongAt:this.lastPongAt,
        nextRetryAt:this.retryAt===null?null:new Date(this.retryAt).toISOString(),compression:this.compression,error:this.error,interval:10,
        heartbeat:this.connection==='connected'?(this.lastPongAt?'verified':'awaiting reply'):'not connected',
        freshness:!newest?.sourceAt?'unknown':newest.stale?'stale':'current'},staleAfterSeconds:STALE_MS/1000,expiresAfterSeconds:EXPIRE_MS/1000};
  }
  diagnostics(){return {counts:structuredClone(this.counts),pingIntervalSeconds:this.pingMs/1000,replyDeadlineSeconds:this.pongMs/1000,...this.snapshot({touch:false}).source};}
  disconnect(status='idle'){
    this.retryAt=null;const socket=this.socket;this.socket=null;this.connection=this.apiKey?status:'not configured';this.pingSentAt=null;this.pingToken=null;if(socket)socket.terminate();this.event(status);
  }
  close(){this.closed=true;this.disconnect('disconnected');clearInterval(this.maintenance);}
}
