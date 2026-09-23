/** Keep at most four HTTP response bodies open. The singleton collector uses a
 * fifth outbound slot for AIS; Cloudflare permits six simultaneous connections.
 * A slot remains held until EOF/cancel, not merely until response headers arrive.
 */
export function pooledFetch(fetchImpl=fetch,limit=4) {
  let active=0;const queue=[];
  function drain(){while(active<limit&&queue.length){const job=queue.shift();if(job.signal?.aborted){job.reject(job.signal.reason);continue;}active++;job.resolve();}}
  return async (url,options={})=>{
    const signal=options.signal;
    if(signal?.aborted)throw signal.reason;
    if(queue.length>=64)throw new Error('Source request queue is full.');
    await new Promise((resolve,reject)=>{
      const job={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();},reject,signal};
      const abort=()=>{const i=queue.indexOf(job);if(i!==-1){queue.splice(i,1);reject(signal.reason);}};
      signal?.addEventListener('abort',abort,{once:true});queue.push(job);drain();
    });
    let released=false;const release=()=>{if(!released){released=true;active--;drain();}};
    try {
      const response=await fetchImpl(url,options);
      if(!response.body){release();return response;}
      const reader=response.body.getReader();
      const body=new ReadableStream({
        async pull(controller){try{const item=await reader.read();if(item.done){release();controller.close();}else controller.enqueue(item.value);}catch(error){release();controller.error(error);}},
        async cancel(reason){try{await reader.cancel(reason);}finally{release();}},
      });
      return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch(error){release();throw error;}
  };
}
