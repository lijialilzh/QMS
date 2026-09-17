#!/usr/bin/env python
# coding: utf-8

import os
import pandas as pd
from interval import Interval as I
import numpy as np
import statsmodels.api as sm


excel_path = "/media/tx-deepocean/Data1/DATA/CT骨折注册/NMPA注册/ct-chest-1mm/data/input_distribution-分割final.xlsx"

df = pd.read_excel(excel_path)

# dispersed_para = ['SEX','DEVICE','ConvolutionKernel','KVP','THICKNESS']
# dispersed_para = ['SEX','DEVICE','ConvolutionKernel','KVP','THICKNESS','Columns','PatientPosition','translation','rotate','background','crop']
# range_para = ['AGE']

dispersed_para = ['SEX','DEVICE','state','KVP','THICKNESS',"ConvolutionKernel"]
range_para = ['AGE']
parameter_range = {}
parameter_range = {}

parameter_range['AGE'] = [0,18,40,60,110]
parameter_range['THICKNESS'] = [0.25,1.25,2]
parameter_range['CTDIvol'] = [0,10,2000,9999]
parameter_range['PixelSpacing']=[0,0.6,0.8,2,9999]
parameter_range['Exposure'] = [-1,5,10,15,20,9999]
parameter_range['KVP'] = [40,60,70,90,140,10000]
parameter_range['Columns'] = [700,1400,1800,2200,2600,3500]
parameter_range['PixelSpacing'] = [0.1,0.15,0.2]

dice_result = []
triage_result = []

def cal_95CI(TP,pos,TN,neg):
    case_sen_interval = tuple([round(i,3) for i in list(sm.stats.proportion_confint(TP,pos,alpha=0.05, method='normal'))])
    case_spe_interval = tuple([round(i,3) for i in list(sm.stats.proportion_confint(TN,neg,alpha=0.05, method='normal'))])
    if pos != 0:
        sen = str(round(TP/pos,3))+str(case_sen_interval)
    else:
        sen = 'none'
    if neg != 0:
        spe = str(round(TN/neg,3))+str(case_spe_interval)
    else:
        spe= 'none'
    return sen, spe

def get_cases(tmp_df):
    result = []
    for i in tmp_df.groups:
        # print ('interval',str(i),'cases',tmp_df.groups[i].size)
        result.append({'interval':str(i),'cases': tmp_df.groups[i].size}) #,ignore_index=True) #len(tmp_df.groups[i].value_counts())},ignore_index=True)
        # print (result)
    return result
    

for key in dispersed_para:
    for factor in df.groupby(key).groups.keys():
        pos =df[(df[key]==factor)&(df['gt']==1)]['TXID'].count()
        neg= df[(df[key]==factor)&(df['gt']==0)]['TXID'].count()
        TP = df[(df[key]==factor)&(df['gt']==1)&(df['pred']==1)]['TXID'].count()
        TN = df[(df[key]==factor)&(df['gt']==0)&(df['pred']==0)]['TXID'].count()
        sen,spe = cal_95CI(TP,pos,TN,neg)
        triage_result.append({'Item':key,'Catgory':factor,'pos_cases':pos,'neg_cases':neg,'Sen':sen,'Spe':spe})
        # print (key,factor,pos_cases,neg_cases,case_sen_interval,case_spec_interval)
        dice_df = df[(df['gt']==1)&(df['pred']==1)&(df[key]==factor)]['dice']
        mean_dice = dice_df.mean()
        std_dice = dice_df.std()
        dice_result.append({'Item':key,'Catgory':factor,'cases':TP,'Mean':mean_dice,'Std':std_dice})
        # print (factor,mean_dice,std_dice)

for key in range_para:
    # print (key)
    df_pos = df[df['gt']==1]
    df_TP = df[(df['gt']==1)&(df['pred']==1)]
    df_neg = df[df['gt']==0]
    df_TN = df[(df['gt']==0)&(df['pred']==0)]

   
    tmp_df_pos = df_pos.groupby(pd.cut(df_pos[key],parameter_range[key]))
    result_pos = get_cases(tmp_df_pos)
    # print (result_pos)
    tmp_df_neg = df_neg.groupby(pd.cut(df_neg[key],parameter_range[key]))
    result_neg = get_cases(tmp_df_neg)
    tmp_df_TP = df_TP.groupby(pd.cut(df_TP[key],parameter_range[key]))
    result_TP = get_cases(tmp_df_TP)
    tmp_df_TN = df_TN.groupby(pd.cut(df_TN[key],parameter_range[key]))
    result_TN = get_cases(tmp_df_TN)
    for i in range(len(result_pos)):
        pos = result_pos[i]['cases']
        TP = result_TP[i]['cases']
        TN = result_TN[i]['cases']
        neg = result_neg[i]['cases']
        sen,spe = cal_95CI(TP,pos,TN,neg)
        triage_result.append({'Item':key,'Catgory':result_pos[i]['interval'],'pos_cases':pos,'neg_cases':neg,'Sen':sen,'Spe':spe})
        
    tmp_dice = tmp_df_TP['dice']
    # cases = tmp_dice.count()
    
    dice_mean_result = tmp_dice.mean().to_frame()
    dice_std_result = tmp_dice.std().to_frame()
    item = dice_mean_result['dice']
    item1 = dice_std_result['dice']
    for i in range(len(item)):
            cat = item.index[i]
            mean_dice = item.iloc[i]
            std_dice = item1.iloc[i]
            
            dice_result.append({'Item':key,'Catgory':str(cat),'cases':result_TP[i]['cases'],'Mean':mean_dice,'Std':std_dice})

pos =df[(df['gt']==1)]['TXID'].count()
neg= df[(df['gt']==0)]['TXID'].count()
TP = df[(df['gt']==1)&(df['pred']==1)]['TXID'].count()
TN = df[(df['gt']==0)&(df['pred']==0)]['TXID'].count()  
sen,spe = cal_95CI(TP,pos,TN,neg)
triage_result.append({'Item':'All','Catgory':'','pos_cases':pos,'neg_cases':neg,'Sen':sen,'Spe':spe})

dice_df = df[(df['gt']==1)&(df['pred']==1)]['dice']
mean_dice = dice_df.mean()
std_dice = dice_df.std()
dice_result.append({'Item':'All','Catgory':'','cases':TP,'Mean':mean_dice,'Std':std_dice})



result_excel = excel_path.replace('.xlsx','_result-all.xlsx')
writer = pd.ExcelWriter(result_excel)



dice_df = pd.DataFrame(dice_result)
dice_df = dice_df[['Item','Catgory','cases','Mean','Std']]

device_df = pd.DataFrame(triage_result)
device_df = device_df[['Item','Catgory','pos_cases','neg_cases']]

result_df = pd.DataFrame(triage_result)
result_df = result_df[['Item','Catgory','pos_cases','neg_cases','Sen','Spe']]

result_df.to_excel(writer,'stat result',index=False)   
dice_df.to_excel(writer,'dice result',index=False)
device_df.to_excel(writer,'device distribution',index=False)
writer.save()





