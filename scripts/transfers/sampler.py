"""Compiled kernels for the exact collapsed Dirichlet-multinomial model."""
import math
import numpy as np
from numba import njit

@njit(cache=True)
def cell_mass(t,a):
    return math.lgamma(t+a)-math.lgamma(t+1)

@njit(cache=True)
def row_density(alpha,t,row,shape,rate):
    asum=alpha.sum();value=0.
    for u in range(len(t)):
        n=t[u,row].sum()
        value+=math.lgamma(asum)-math.lgamma(asum+n)
        for c in range(len(alpha)):
            value+=math.lgamma(alpha[c]+t[u,row,c])-math.lgamma(alpha[c])
    for a in alpha:value+=(shape-1)*math.log(a)-rate*a
    return value

@njit(cache=True)
def run(t,alpha,seed,draws,tune,thin,shape,rate):
    np.random.seed(seed)
    units,rows,cols=t.shape
    saved=np.empty((draws,rows,cols),dtype=np.int64)
    alphas=np.empty((draws,rows,cols))
    acceptance=0;proposals=0;idx=0
    for iteration in range(tune+draws*thin):
        row_order=np.random.permutation(rows);col_order=np.random.permutation(cols)
        for ii in range(rows-1):
            i,k=row_order[ii],row_order[ii+1]
            for jj in range(cols-1):
                j,l=col_order[jj],col_order[jj+1]
                for u in range(units):
                    a=t[u,i,j];b=t[u,i,l];c=t[u,k,j];d=t[u,k,l]
                    low=max(0,a-d);high=min(a+b,a+c)
                    z=np.random.randint(low,high+1)
                    pa=z;pb=a+b-z;pc=a+c-z;pd=d-a+z
                    ratio=(cell_mass(pa,alpha[i,j])+cell_mass(pb,alpha[i,l])+cell_mass(pc,alpha[k,j])+cell_mass(pd,alpha[k,l])
                           -cell_mass(a,alpha[i,j])-cell_mass(b,alpha[i,l])-cell_mass(c,alpha[k,j])-cell_mass(d,alpha[k,l]))
                    if math.log(np.random.random())<ratio:
                        t[u,i,j]=pa;t[u,i,l]=pb;t[u,k,j]=pc;t[u,k,l]=pd
        for row in range(rows):
            current=alpha[row].copy();proposal=current*np.exp(np.random.normal(0,.12,size=cols))
            ratio=row_density(proposal,t,row,shape,rate)-row_density(current,t,row,shape,rate)+np.log(proposal/current).sum()
            if math.log(np.random.random())<ratio:
                alpha[row]=proposal;acceptance+=1
            proposals+=1
            # Concentration scale is strongly correlated across destinations.
            # An additional common-scale move leaves composition unchanged.
            current=alpha[row].copy();proposal=current*math.exp(np.random.normal(0,.3))
            ratio=row_density(proposal,t,row,shape,rate)-row_density(current,t,row,shape,rate)+np.log(proposal/current).sum()
            if math.log(np.random.random())<ratio:alpha[row]=proposal
        if iteration>=tune and (iteration-tune)%thin==0:
            saved[idx]=t.sum(axis=0);alphas[idx]=alpha;idx+=1
    return saved,alphas,acceptance/proposals
