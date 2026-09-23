import {DatabaseSync} from 'node:sqlite';

export function sqliteState() {
  const db=new DatabaseSync(':memory:');let alarm=null;
  const state={db,waits:[],fail:null,alarmWrites:0,waitUntil(promise){this.waits.push(promise);},storage:{
    sql:{exec(query,...params){
      if(state.fail?.(query))throw new Error('Injected SQL failure');
      const stmt=db.prepare(query);return stmt.columns().length?stmt.all(...params):(stmt.run(...params),[]);
    }},
    transactionSync(callback){db.exec('BEGIN');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},
    async getAlarm(){return alarm;},async setAlarm(value){alarm=value;state.alarmWrites++;},async deleteAlarm(){alarm=null;},
  },clearAlarm(){alarm=null;}};
  return state;
}

export class FakeSocket extends EventTarget {
  static sockets=[];
  constructor(url){super();this.url=url;this.sent=[];this.closed=false;FakeSocket.sockets.push(this);}
  open(){this.dispatchEvent(new Event('open'));}
  message(data){const event=new Event('message');event.data=typeof data==='object'&&!(data instanceof ArrayBuffer)?new TextEncoder().encode(JSON.stringify(data)).buffer:data;this.dispatchEvent(event);}
  send(data){this.sent.push(data);}
  close(){this.closed=true;this.dispatchEvent(new Event('close'));}
}

export const position=(now,{mmsi=123456789,sourceAt=new Date(now).toISOString(),latitude=26.1,longitude=56.2}={})=>({MessageType:'PositionReport',MetaData:{MMSI:mmsi,ShipName:'TEST TANKER',time_utc:sourceAt},Message:{PositionReport:{UserID:mmsi,Latitude:latitude,Longitude:longitude,Sog:10,Cog:90,TrueHeading:90}}});
export const confirmation={MessageType:'SubscriptionConfirmation',Message:{CompressionEnabled:true}};
