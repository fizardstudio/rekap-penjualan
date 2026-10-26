import json,openpyxl,collections,sys
U=(sys.argv[1].rstrip("/\\")+"/") if len(sys.argv)>1 else "../Bahan/"
d=json.load(open("seed.json"))
sat={s["id"]:s for s in d["satker"]}
def tot(t):
    b=sum(i["qty"]*i["harga"] for i in t["items"])
    return b if t["inclPPN"] else round(b*1.11)
for fn,yr in [("BELANJA BPN 2025.xlsx",2025),("BELANJA BPN 2026.xlsx",2026)]:
    ws=openpyxl.load_workbook(U+fn,data_only=True)["BERANDA"]
    mine=collections.defaultdict(float)
    for t in d["transaksi"]:
        if t["tanggal"][:4]==str(yr) and "BELANJA" in t["catatan"]:
            mine[(t["cv"],int(t["tanggal"][5:7]))]+=tot(t)
    print("==",fn)
    for r,cv in [(4,"PKM"),(5,"OSI"),(6,"DKS")]:
        for m in range(1,13):
            ex=ws.cell(r,8+m).value or 0
            me=mine.get((cv,m),0)
            if abs(ex-me)>1: print(f"  {cv} bln {m}: excel {ex:,.0f}  app {me:,.0f}  selisih {me-ex:,.0f}")
        print(" ",cv,"excel",f"{sum((ws.cell(r,8+m).value or 0) for m in range(1,13)):,.0f}","app",f"{sum(v for (c,m),v in mine.items() if c==cv):,.0f}")
wb=openpyxl.load_workbook(U+"DATA REKAP DIGIPAY 2025 CV. ONIX STATIONERY IDEAL.xlsx",data_only=True)
mine=collections.defaultdict(float); cnt=collections.Counter()
for t in d["transaksi"]:
    if "DIGIPAY 2025" in t["catatan"]:
        sh=t["catatan"].split("sheet ")[1]; mine[sh]+=tot(t); cnt[sh]+=1
for ws in wb.worksheets[1:]:
    ex=ws["G2"].value or 0; exn=ws["G1"].value
    if abs(ex-mine[ws.title])>1 or (exn or 0)!=cnt[ws.title]: print(f"  {ws.title}: excel {ex:,.0f} ({exn} trx)  app {mine[ws.title]:,.0f} ({cnt[ws.title]} trx)")
print("digipay excel grand", f'{wb["HOME"]["F28"].value:,.0f}', "app (sheet di HOME saja)")
