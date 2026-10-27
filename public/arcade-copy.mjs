import {outcomeDetail} from './marathon.mjs';
export const compactPlayerName=name=>name?.replace(/ \(server bridge\)$/,'').replace(/^Local lookahead depth ([1-6])$/,'Lookahead · $1')??'Computer';
export const visibleOutcome=(status,observation,error)=>status==='error'&&error?'':['won','capped','over','error'].includes(status)?outcomeDetail(status,observation,error):'';
