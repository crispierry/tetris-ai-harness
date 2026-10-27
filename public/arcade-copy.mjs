import {outcomeDetail} from './marathon.mjs';
export const compactPlayerName=name=>name?.replace(/ \(server bridge\)$/,'')??'Computer';
export const visibleOutcome=(status,observation,error)=>['won','capped','over','error'].includes(status)?outcomeDetail(status,observation,error):'';
