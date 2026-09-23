import {DurableObject} from 'cloudflare:workers';
import {Collector} from './collector.mjs';
import {handlePublic} from './policy.mjs';

const singleton=env=>env.PASSAGE_DATA.get(env.PASSAGE_DATA.idFromName('passage-public-collector-v1'));

export class PassageCollector extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);this.collector=new Collector(ctx,env);
    // Initialization only restores bounded local records and schedules work;
    // upstream requests run in the alarm, outside the constructor's time limit.
    ctx.blockConcurrencyWhile(()=>this.collector.initialize());
  }
  fetch(request){return this.collector.fetch(request);}
  alarm(){return this.collector.alarm();}
}

export default {
  fetch(request,env){return handlePublic(request,env,internal=>singleton(env).fetch(internal));},
  async scheduled(_event,env){
    // A platform cron restarts scheduling after eviction, failed alarms or a
    // daily quota reset. The public router never forwards this internal path.
    const response=await singleton(env).fetch(new Request('https://collector.internal/_collect',{method:'POST'}));
    if(!response.ok)throw new Error('Collector recovery failed.');
  },
};
