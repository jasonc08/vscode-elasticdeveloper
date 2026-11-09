'use strict'



export interface ElasticsearchResponse {

    name?:string;

    message:string;

    completed:boolean;

    statusCode?:number;

    headers?:object;

    request?:object;

    body?:any

    environment?:string

}