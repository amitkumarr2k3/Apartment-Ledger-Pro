import pandas as pd, yaml, re
from pathlib import Path
from datetime import datetime

INPUT_DIR='input'
OUTPUT_FILE='output/transactions.xlsx'
CONFIG_FILE='config/mapping.yaml'

with open(CONFIG_FILE,'r') as f:
    cfg=yaml.safe_load(f)

months={"April":4,"May":5,"June":6,"July":7,"August":8,"September":9,"October":10,"November":11,"December":12,"January":1,"February":2,"March":3}

expense_map={}
for k,v in cfg.get('expense_categories',{}).items():
    for item in v: expense_map[item]=k
income_map={}
for k,v in cfg.get('income_categories',{}).items():
    for item in v: income_map[item]=k
vendors=cfg.get('vendors',{})
rows=[]

for file in Path(INPUT_DIR).glob('*.xls*'):
    name=file.name.lower()
    head='expense' if 'expense' in name else 'income'
    direction='D' if head=='expense' else 'C'

    raw=pd.read_excel(file,header=None)
    fy=''
    for _,r in raw.iterrows():
        txt=' '.join([str(x) for x in r if pd.notna(x)])
        if 'Financial Year' in txt:
            fy=txt
            break
    m=re.search(r'(\d{4})-(\d{4})',fy)
    start,end=int(m.group(1)),int(m.group(2))

    hdr=next(i for i,r in raw.iterrows() if 'April' in [str(x) for x in r.values])
    df=pd.read_excel(file,header=hdr)
    ledger_col=df.columns[0]

    for _,r in df.iterrows():
        ledger=str(r[ledger_col]).strip()
        if ledger.lower()=='total':
            continue
        for mon,num in months.items():
            if mon not in df.columns: continue
            amt=r.get(mon)
            if pd.isna(amt) or float(amt)==0: continue
            yr=start if num>=4 else end
            cat=(expense_map if head=='expense' else income_map).get(ledger,'Uncategorized')
            v=vendors.get(ledger,{})
            vendor=v.get('vendor','Individual')
            vk=v.get('vendor_kind','individual')
            rows.append({
                'date':f'{yr}-{num:02d}-01','head':head,'category':cat,
                'vendor':vendor,'vendor_kind':vk,'line_item':ledger,
                'amount':amt,'direction':direction,'flat_code':'',
                'source_ref':f'{direction}|{cat}|{vendor}|{ledger}|{yr}-{num:02d}'})

pd.DataFrame(rows).to_excel(OUTPUT_FILE,index=False)
print('done')
