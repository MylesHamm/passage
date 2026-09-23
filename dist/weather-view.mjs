export function weatherDisplay(model,kind,now=Date.now()){
 if(!model)return {available:false,label:'Unavailable',validAt:null,values:{}};
 const time=kind==='wind'?model.current?.time:model.hourly?.time?.find(t=>Date.parse(t+'Z')<=now&&Date.parse(t+'Z')+3600000>now);
 const ms=time?Date.parse(time+'Z'):NaN,age=now-ms,valid=Number.isFinite(ms)&&age>=-300000&&age<(kind==='wind'?7200000:3600000);
 const i=model.hourly?.time?.indexOf(time);const values=kind==='wind'?model.current||{}:{wave_height:model.hourly?.wave_height?.[i]??null,wave_period:model.hourly?.wave_period?.[i]??null};
 return {available:valid,label:valid?'Forecast valid':'Forecast expired or time unavailable',validAt:Number.isFinite(ms)?new Date(ms).toISOString():null,values:valid?values:{},grid:model.latitude!=null?`${model.latitude.toFixed(3)}° N, ${model.longitude.toFixed(3)}° E`:null};
}
