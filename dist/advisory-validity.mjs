// Derived only from archived calendar dates. This does not revalidate a notice
// with its publisher or change its recorded source status/retrieval time.
export function advisoryValidity(record,now=Date.now()) {
  if(!Number.isFinite(now)||Math.abs(now)>8640000000000000)return 'unknown';
  const today=new Date(now).toISOString().slice(0,10);
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(record.supersededBy?.length)return 'superseded';
  if(record.sourceStatus==='cancelled')return 'cancelled';
  if(validDay(record.expiresDate)&&today>record.expiresDate)return 'expired';
  if(validDay(record.effectiveDate)&&today<record.effectiveDate)return 'not-yet-effective';
  if(record.sourceStatus==='active'&&validDay(record.effectiveDate)&&validDay(record.expiresDate)&&record.effectiveDate<=record.expiresDate)return 'active';
  return 'unknown';
}
