import sys, json, math, os
# usage: build_fixtures.py ITEMS.json BUNDLE.js OUTDIR -> derived (not captured) request payloads + cost tables
items = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[3]; os.makedirs(out, exist_ok=True)
LABEL = f'DERIVED from HTML5 client {os.path.basename(sys.argv[2])} + {os.path.basename(sys.argv[1])}, NOT captured from a live session'

def w(name, obj):
    with open(os.path.join(out, name), 'w') as f:
        json.dump({'_label': LABEL, **obj}, f, indent=2)

# Open gate: PlayerConst.getOpenGateCosts (ggs.dll @2643873): 10*round(OPEN_GATE_C2[d]*n^(1.1+n/10)/10), n=min(9, openGateCounter+1)
OPEN_GATE_C2 = [450, 700]; OPEN_GATE_DURATION = [21600, 43200]
gate = []
for counter in range(0, 10):
    n = min(9, counter + 1)
    gate.append({'openGateCounter_OGC': counter, **{f'CD{d}_{OPEN_GATE_DURATION[d]//3600}h_rubies': 10 * math.floor(OPEN_GATE_C2[d] * n ** (1.1 + n / 10) / 10 + 0.5) for d in (0, 1)}})
dethrone = [{'rerollCount': int(r['rerollCount']), 'exile_c1': int(r['c1Cost']), 'fortify_c2': int(r['c2Cost'])}
            for r in items['rerollCosts'] if r['type'] == 'alien']
diffs = [{k: r.get(k) for k in ('difficultyID', 'eventID', 'difficultyTypeID', 'isLocked', 'rentC2Cost')}
         for r in items['eventAutoScalingDifficulties'] if r['eventID'] in ('71', '103')]
w('cost-tables.json', {'openGate_before_discounts': gate, 'dethrone_rerollCosts_alien': dethrone, 'alienDifficulties_sede_EDID': diffs,
   'stationDuration': {'WT_hours_range': [1, 99], 'freeHours': {'castle': 12, 'occupied': 24, 'capitalOrMetropol': 72}, 'rubiesPerExtraHour': 275}})

w('foreign-lords.json', {
    'find_target_fnm': {'cmd': 'fnm', 'payload': {'T': 21, 'KID': 0, 'LMIN': -1, 'LMAX': -1, 'NID': -701}},
    'pick_difficulty_sede': {'cmd': 'sede', 'payload': {'EID': 71, 'EDID': 1, 'C2U': 0}, 'note': 'EDID 1..4 free, 5..11 need C2U:1 and rentC2Cost rubies'},
    'points_pep': {'cmd': 'pep', 'payload': {'EID': 71}, 'reply_fields': {'EID': 71, 'OR': '[playerRank, allianceRank]', 'OP': '[playerGloryPoints, allianceGloryPoints]'}},
    'attack_info_adi': {'cmd': 'adi', 'payload': {'SX': 100, 'SY': 200, 'TX': 110, 'TY': 210, 'KID': 0}},
    'gaa_AI_shape': ['areaType(21)', 'X', 'Y', 'dungeonLevel', 'secondsSinceEspionage', 'hasPeaceMode(0/1)', 'baseWallBonus', 'baseGateBonus', 'baseMoatBonus', 'alreadyRerolled(0/1)', 'eventAutoScalingCampID'],
    'ownerID': -1000})
w('bloodcrow.json', {
    'find_target_fnm': {'cmd': 'fnm', 'payload': {'T': 34, 'KID': 0, 'LMIN': -1, 'LMAX': -1, 'NID': -701}},
    'pick_difficulty_sede': {'cmd': 'sede', 'payload': {'EID': 103, 'EDID': 101, 'C2U': 0}, 'note': 'EDID 101..104 free, 105..111 rented'},
    'points_pep': {'cmd': 'pep', 'payload': {'EID': 103}},
    'ownerID': -1002})
w('dethrone-rae.json', {
    'exile_with_coins': {'cmd': 'rae', 'payload': {'XPOS': 110, 'YPOS': 210, 'RCK': 'C1'}},
    'fortify_with_rubies': {'cmd': 'rae', 'payload': {'XPOS': 110, 'YPOS': 210, 'RCK': 'C2'}},
    'note': 'RCK is a server currency key; soft keys come from sei RCKS. Key order follows JSON.stringify insertion (XPOS,YPOS defaults first, then RCK). Reply: error code only; ALL_OK opens a success dialog.'})
w('cra-banner-wave.json', {
    'note': 'Banners have slotTypes 1,2,9 and go in a wave tool list (L/M/R .T as [wodID, amount]); AST holds 3 support-tool wodIDs (slotType 10) or -1.',
    'cmd': 'cra', 'payload': {'SX': 100, 'SY': 200, 'TX': 110, 'TY': 210, 'KID': 0, 'LID': 1, 'WT': 0, 'HBW': -1, 'BPC': 0, 'ATT': 0, 'AV': 0, 'LP': 0, 'FC': 0, 'PTT': 0, 'SD': 0, 'ICA': 0, 'CD': 99,
        'A': [{'L': {'T': [[661, 5]], 'U': [[10, 100]]}, 'M': {'T': [[611, 10]], 'U': [[10, 100]]}, 'R': {'T': [[661, 5]], 'U': [[10, 100]]}}],
        'BKS': [], 'AST': [-1, -1, -1], 'RW': [[-1, 0]] * 8, 'ASCT': 0}})
w('station.json', {
    'support_info_sdi': {'cmd': 'sdi', 'payload': {'TX': 300, 'TY': 400, 'SX': 100, 'SY': 200},
        'reply_fields': ['SCID (source castle id)', 'gaa.AI/OI (target)', 'gui.I/SHI (own inventory)', 'UYL/AUYL/UWL (yard/alliance-yard/wall unit limits)', 'S/AS/B/LS (spy army info)', 'gli (lords)']},
    'station_cds': {'cmd': 'cds', 'payload': {'SID': 1234567, 'TX': 300, 'TY': 400, 'LID': 1, 'WT': 12, 'HBW': -1, 'BPC': 0, 'PTT': 0, 'SD': 0, 'A': [[10, 200], [608, 300]]},
        'note': 'SID = source castle objectId; WT = hours 1..99; A = flat [wodID, amount] list; reply {gcu, O, A(movement)}'},
    'recall_mcm': {'cmd': 'mcm', 'payload': {'MID': 987654}, 'note': 'MID = gam movement M.MID of your T=1 (MOVEMENTTYPE_DEFENCE) movement; reply {A: updated movement}'},
    'list_gam': {'cmd': 'gam', 'payload': {}, 'stationed_when': 'M.T==1 && M.OID==me && M.PT>=M.TT; UM.TWD/UM.PWD = total/passed station seconds'}})
w('open-gate-mos.json', {
    'open_6h': {'cmd': 'mos', 'payload': {'CID': 1234567, 'KID': 0, 'CD': 0}},
    'open_12h': {'cmd': 'mos', 'payload': {'CID': 1234567, 'KID': 0, 'CD': 1}},
    'cancel': {'cmd': 'mos', 'payload': {'CID': 1234567, 'KID': 0, 'CD': -1}},
    'reply_fields': {'gcu': '{C1, C2}', 'CID': 'castle id', 'KID': 'kingdom', 'RPT': 'remaining open-gate seconds (0 = finished)'},
    'errors': {'2 INVALID_PARAMETER_VALUE': 'protection mode active (error_openGate_eilandProtection)'}})
w('tools-production.json', {
    'list_spl': {'cmd': 'spl', 'payload': {'LID': 1}, 'reply_fields': ['LID', 'QS (queue)', 'PS (current production slot)', 'RM (recruitment mode)', 'TCT (seconds left)']},
    'produce_bup': {'cmd': 'bup', 'payload': {'LID': 1, 'WID': 611, 'AMT': 50, 'PO': -1, 'PWR': 0, 'SK': 73, 'SID': 0, 'AID': 1234567}, 'note': 'SID = kingdom id, AID = castle areaId; LID 1 is shared by siege and defence workshops'},
    'unlock_slot_ups': {'cmd': 'ups', 'payload': {'LID': 1}, 'note': 'UNLOCK_C2=375 rubies'},
    'research_rei': {'cmd': 'rei', 'payload': {}, 'reply_fields': {'BR': '[bought researchIDs]', 'ARID': 'active research', 'ARRT': 'seconds left'}},
    'sceat_skills_skl': {'cmd': 'skl', 'payload': {}, 'reply_fields': {'SIDS': '[active sceat skill IDs] -> sceatSkills.effects 46&wod (enableUnits) / 84&wod (disableUnits)', 'SID': 'legend skills', 'SP': 'skill points'}}})
w('armorer-sbp.json', {
    'buy_tools_with_coins': {'cmd': 'sbp', 'payload': {'PID': 32, 'BT': 0, 'TID': 27, 'AMT': 10, 'KID': 0, 'AID': -1, 'PC2': -1, 'BA': 0, 'PWR': 0, '_PO': -1}},
    'note': 'Package 32 = Battering ram (wod 611) x1 for 430 C1 in items; the live offer list is sei event 27 PIDS. Reply {gcu, gui, grc, cpi, sin, vip, ...}; errors 10 NOT_ENOUGH_CURRENCY1, 154 STORAGE_CAPACITY_REACHED.'})
print('fixtures written to', out)
