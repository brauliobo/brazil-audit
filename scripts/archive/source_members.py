"""Choose one complete official representation of an electoral archive."""
def source_members(names):
    data=[n for n in names if n.lower().endswith(('.csv','.txt'))]
    national=[n for n in data if n.rsplit('/',1)[-1].rsplit('.',1)[0].upper().rsplit('_',1)[-1]=='BRASIL']
    if len(national)>1:raise ValueError('Multiple national data representations require an explicit source profile')
    return national if national else data

