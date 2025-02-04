import {Component, OnDestroy, OnInit, ViewContainerRef} from '@angular/core';
import {User} from '../../models/user';
import {ConfirmComponent} from '../../widgets/dialogs/confirm/confirm.component';
import { MatDialogConfig, MatDialog, MatDialogRef } from '@angular/material/dialog';
import * as _ from 'lodash-es';
import {AppService} from '../../app.service';
import {ExportService} from './export.service';
import {ExportDialogComponent} from '../../widgets/dialogs/export/export.component';
import {WindowRefService} from "../../helpers/window-ref.service";
import {HttpErrorHandler} from "../../helpers/http-error-handler";
import {J4careHttpService} from "../../helpers/j4care-http.service";
import {j4care} from "../../helpers/j4care.service";
import * as FileSaver from 'file-saver';
import {LoadingBarService} from "@ngx-loading-bar/core";
import {Globalvar} from "../../constants/globalvar";
import {ActivatedRoute} from "@angular/router";
import {CsvUploadComponent} from "../../widgets/dialogs/csv-upload/csv-upload.component";
import {AeListService} from "../../configuration/ae-list/ae-list.service";
import {PermissionService} from "../../helpers/permissions/permission.service";
import {Validators} from "@angular/forms";
import {KeycloakService} from "../../helpers/keycloak-service/keycloak.service";
import {map} from "rxjs/operators";


@Component({
  selector: 'app-export',
  templateUrl: './export.component.html'
})
export class ExportComponent implements OnInit, OnDestroy {
    matches = [];
    user: User;
    exporters;
    exporterID;
    showMenu;
    aets;
    exportTasks = [];
    timer = {
        started:false,
        startText:$localize `:@@start_auto_refresh:Start Auto Refresh`,
        stopText:$localize `:@@stop_auto_refresh:Stop Auto Refresh`
    };
    statusValues = {};
    refreshInterval;
    externalRetrieveEntries;
    interval = 10;
    Object = Object;
    batchGrouped = false;
    dialogRef: MatDialogRef<any>;
    _ = _;
    devices;
    count;
    allAction;
    allActionsOptions = [
        {
            value:"cancel",
            label:$localize `:@@cancel_all_matching_tasks:Cancel all matching tasks`
        },{
            value:"reschedule",
            label:$localize `:@@reschedule_all_matching_tasks:Reschedule all matching tasks`
        },{
            value:"mark4export",
            label:$localize `:@@mark4export_all_matching_tasks:Mark all matching tasks for export`
        },{
            value:"delete",
            label:$localize `:@@edelete_all_matching_tasks:Delete all matching tasks`
        }
    ];
    allActionsActive = [];
    tableHovered = false;
    filterSchema;
    filterObject:any = {};
    urlParam;
    constructor(
        public $http:J4careHttpService,
        public cfpLoadingBar: LoadingBarService,
        public mainservice: AppService,
        public  service: ExportService,
        public viewContainerRef: ViewContainerRef,
        public dialog: MatDialog,
        public config: MatDialogConfig,
        private httpErrorHandler:HttpErrorHandler,
        private route: ActivatedRoute,
        public aeListService:AeListService,
        private permissionService:PermissionService,
        private _keycloakService: KeycloakService
    ) {}
    ngOnInit(){
        this.initCheck(10);
    }
    initCheck(retries){
        let $this = this;
        if((KeycloakService.keycloakAuth && KeycloakService.keycloakAuth.authenticated) || (_.hasIn(this.mainservice,"global.notSecure") && this.mainservice.global.notSecure)){
            this.route.queryParams.subscribe(params => {
                this.urlParam = Object.assign({},params);
                this.init();
            });
        }else{
            if (retries){
                setTimeout(()=>{
                    $this.initCheck(retries-1);
                },20);
            }else{
                this.init();
            }
        }
    }
    init(){
        this.route.queryParams.subscribe(params => {
            if(params && params['dicomDeviceName']){
                this.filterObject['dicomDeviceName'] = params['dicomDeviceName'];
                this.search(0);
            }
        });
        this.initExporters(1);
        this.getAets();
        // this.init();
        this.service.statusValues().forEach(val =>{
            this.statusValues[val.value] = {
                count: 0,
                loader: false,
                text:val.text
            };
        });
        this.statusChange();
    }
    initSchema(){
        this.setFilterSchema();
        if(this.urlParam){
            this.filterObject = this.urlParam;
            this.filterObject["limit"] = 20;
        }
    }
    setFilterSchema(){
        this.filterSchema = this.service.getFilterSchema(this.exporters, this.devices,$localize `:@@count_param:COUNT ${((this.count || this.count == 0)?this.count:'')}:@@count:`);
    }
    onFormChange(e){
        console.log("e",e);
        this.statusChange();
    }
    // changeTest(e){
    //     console.log("changetest",e);
    //     this.filterObject.createdTime = e;
    // }

    filterKeyUp(e){
        let code = (e.keyCode ? e.keyCode : e.which);
        if (code === 13){
            this.search(0);
        }
    };
    confirm(confirmparameters){
        this.config.viewContainerRef = this.viewContainerRef;
        this.dialogRef = this.dialog.open(ConfirmComponent,{
            height: 'auto',
            width: '465px'
        });
        this.dialogRef.componentInstance.parameters = confirmparameters;
        return this.dialogRef.afterClosed();
    };
    toggleAutoRefresh(){
        this.timer.started = !this.timer.started;
        if(this.timer.started){
            this.getCounts();
            this.refreshInterval = setInterval(()=>{
                this.getCounts();
            },this.interval*1000);
        }else
            clearInterval(this.refreshInterval);
    }
    tableMousEnter(){
        this.tableHovered = true;
    }
    tableMousLeave(){
        this.tableHovered = false;
    }
    onSubmit(object){
        if(_.hasIn(object,"id") && _.hasIn(object,"model")){
            if(object.id === "count"){
                this.getCount();
            }else{
                // this.getTasks(0);
                this.getCounts();
            }
        }
    }
    getCounts(offset?){
        let filters = Object.assign({},this.filterObject);
        if(!this.tableHovered)
            this.search(0);
        Object.keys(this.statusValues).forEach(status=>{
            filters.status = status;
            this.statusValues[status].loader = true;
            this.service.getCount(filters).subscribe((count)=>{
                this.statusValues[status].loader = false;
                try{
                    this.statusValues[status].count = count.count;
                }catch (e){
                    this.statusValues[status].count = "";
                }
            },(err)=>{
                this.statusValues[status].loader = false;
                this.statusValues[status].count = "!";
            });
        });
    }
    downloadCsv(){
        this.confirm({
            content:$localize `:@@use_semicolon_delimiter:Do you want to use semicolon as delimiter?`,
            cancelButton:$localize `:@@no:No`,
            saveButton:$localize `:@@Yes:Yes`,
            result:$localize `:@@yes:yes`
        }).subscribe((ok)=>{
            let semicolon = false;
            if(ok)
                semicolon = true;
            let token;
            this._keycloakService.getToken().subscribe((response)=>{
                if(!this.mainservice.global.notSecure){
                    token = response.token;
                }
                if(!this.mainservice.global.notSecure){
                    // WindowRefService.nativeWindow.open(`../monitor/export?accept=text/csv${(semicolon?';delimiter=semicolon':'')}&access_token=${token}&${this.mainservice.param(this.service.paramWithoutLimit(this.filterObject))}`);
                    j4care.downloadFile(`../monitor/export?accept=text/csv${(semicolon?';delimiter=semicolon':'')}&access_token=${token}&${this.mainservice.param(this.service.paramWithoutLimit(this.filterObject))}`, "export.csv")
                }else{
                    // WindowRefService.nativeWindow.open(`../monitor/export?accept=text/csv${(semicolon?';delimiter=semicolon':'')}&${this.mainservice.param(this.service.paramWithoutLimit(this.filterObject))}`);
                    j4care.downloadFile(`../monitor/export?accept=text/csv${(semicolon?';delimiter=semicolon':'')}&${this.mainservice.param(this.service.paramWithoutLimit(this.filterObject))}`,"export.csv")
                }
            });
        });
    }
    uploadCsv(){
        this.dialogRef = this.dialog.open(CsvUploadComponent, {
            height: 'auto',
            width: '500px'
        });
        this.dialogRef.componentInstance.params = {
            exporterID:this.exporterID || '',
            batchID:this.filterObject['batchID'] || '',
            formSchema:[
                {
                    tag:"input",
                    type:"checkbox",
                    filterKey:"semicolon",
                    description:$localize `:@@use_semicolon_as_delimiter:Use semicolon as delimiter`
                },
                {
                    tag:"input",
                    type:"checkbox",
                    filterKey:"withoutScheduling",
                    description:$localize `:@@without_scheduling:Without Scheduling`
                },{
                    tag:"range-picker-time",
                    type:"text",
                    filterKey:"scheduledTime",
                    description:$localize `:@@scheduled_time:Scheduled time`
                },
                //scheduledTime
                {
                    tag:"select",
                    options:this.aets,
                    showStar:true,
                    filterKey:"LocalAET",
                    description:$localize `:@@local_aet:Local AET`,
                    placeholder:$localize `:@@local_aet:Local AET`,
                    validation:Validators.required
                },
                {
                    tag:"select",
                    options:this.exporters.map(exporter=>{
                        return {
                            value:exporter.id,
                            text:exporter.id
                        }
                    }),
                    showStar:true,
                    filterKey:"exporterID",
                    description:$localize `:@@exporter_id:Exporter ID`,
                    placeholder:$localize `:@@exporter_id:Exporter ID`,
                    validation:Validators.required
                },{
                    tag:"input",
                    type:"number",
                    filterKey:"field",
                    description:$localize `:@@field:Field`,
                    placeholder:$localize `:@@field:Field`,
                    validation:Validators.minLength(1),
                    defaultValue:1
                },
                {
                    tag:"input",
                    type:"text",
                    filterKey:"batchID",
                    description:$localize `:@@batch_id:Batch ID`,
                    placeholder:$localize `:@@batch_id:Batch ID`
                }
            ],
            prepareUrl:(filter)=>{
                let clonedFilters = {};
                if(filter['batchID']) {
                    clonedFilters['batchID'] = filter['batchID'];
                }
                if(filter['withoutScheduling']){
                    if(filter['scheduledTime']) {
                        clonedFilters['scheduledTime'] = filter['scheduledTime'];
                    }
                    return `${j4care.addLastSlash(this.mainservice.baseUrl)}aets/${filter.LocalAET}/rs/studies/csv:${filter.field}/mark4export/${filter.exporterID}${j4care.getUrlParams(clonedFilters)}`
                }else{
                    return `${j4care.addLastSlash(this.mainservice.baseUrl)}aets/${filter.LocalAET}/export/${filter.exporterID}/studies/csv:${filter.field}${j4care.getUrlParams(clonedFilters)}`;
                }
            }
        };
        this.dialogRef.afterClosed().subscribe((ok)=>{
            if(ok){
                console.log("ok",ok);
                //TODO
            }
        });
    }
    showTaskDetail(task){
        this.filterObject.batchID = task.properties.batchID;
        this.batchGrouped = false;
        this.search(0);
    }
    search(offset) {
        let $this = this;
        $this.cfpLoadingBar.start();
        this.service.search(this.filterObject, offset,this.batchGrouped)

            .subscribe((res) => {
                if (res && res.length > 0){
                    $this.matches = res.map((properties, index) => {
                        if(this.batchGrouped){
                            let propertiesAttr = Object.assign({},properties);
                            if(_.hasIn(properties, 'tasks')){
                                let taskPrepared = [];
                                Globalvar.TASK_NAMES.forEach(task=>{
                                    if(properties.tasks[task])
                                        taskPrepared.push({[task]:properties.tasks[task]});
                                });
                                properties.tasks = taskPrepared;
                            }
                            j4care.stringifyArrayOrObject(properties, ['tasks']);
                            j4care.stringifyArrayOrObject(propertiesAttr,[]);
                            $this.cfpLoadingBar.complete();
                            return {
                                offset: offset + index,
                                properties: properties,
                                propertiesAttr: propertiesAttr,
                                showProperties: false
                            };
                        }else{
                            $this.cfpLoadingBar.complete();
                            if (_.hasIn(properties, 'Modality')){
                                properties.Modality = properties.Modality.join(',');
                            }
                            return {
                                offset: offset + index,
                                properties: properties,
                                propertiesAttr: properties,
                                showProperties: false
                            };
                        }
                    });
                }else{
                    $this.cfpLoadingBar.complete();
                    $this.matches = [];
                    this.mainservice.showMsg($localize `:@@no_tasks_found:No tasks found!`)
                }
            }, (err) => {
                $this.cfpLoadingBar.complete();
                $this.matches = [];
                console.log('err', err);
            });
    };
    bachChange(e){
        this.matches = [];
    }
    getCount(){
        this.cfpLoadingBar.start();
        this.service.getCount(this.filterObject).subscribe((count)=>{
            try{
                this.count = count.count;
                this.setFilterSchema();
            }catch (e){
                this.count = "";
            }
            this.cfpLoadingBar.complete();
        },(err)=>{
            this.cfpLoadingBar.complete();
            this.httpErrorHandler.handleError(err);
        });
    }
    statusChange(){
/*        this.allActionsActive = this.allActionsOptions.filter((o)=>{
            if(this.filterObject.status == "SCHEDULED" || this.filterObject.status == $localize `:@@export.in_process:IN PROCESS`){
                return o.value != 'reschedule';
            }else{
                if(!this.filterObject.status || this.filterObject.status === '*' || this.filterObject.status === '')
                    return o.value != 'cancel' && o.value != 'reschedule';
                else
                    return o.value != 'cancel';
            }
        });*/
    }
    allActionChanged(e){
        let text =  $localize `:@@matching_task_question:Are you sure, you want to ${Globalvar.getActionText(this.allAction)} all matching tasks?`;
        let filter = _.cloneDeep(this.filterObject);
        if(filter.status === '*')
            delete filter.status;
        if(filter.dicomDeviceName === '*')
            delete filter.dicomDeviceName;
        delete filter.limit;
        delete filter.offset;
        switch (this.allAction) {
            case "cancel":
                this.confirm({
                    content: text
                }).subscribe((ok) => {
                    if (ok) {
                        this.cfpLoadingBar.start();
                        this.service.cancelAll(filter).subscribe((res) => {
                            this.cfpLoadingBar.complete();
                            if(_.hasIn(res,"count")){
                                this.mainservice.showMsg($localize `:@@tasks_canceled_param:${res.count}:@@count: tasks canceled successfully!`);
                            }else{
                                this.mainservice.showMsg($localize `:@@tasks_canceled:Tasks canceled successfully!`);
                            }
                        }, (err) => {
                            this.cfpLoadingBar.complete();
                            this.httpErrorHandler.handleError(err);
                        });
                    }
                    this.allAction = "";
                    this.allAction = undefined;
                });
                break;
            case "reschedule":
                this.rescheduleDialog((ok)=>{
                    if (ok) {
                        this.cfpLoadingBar.start();
                        if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                            filter["newDeviceName"] = ok.schema_model.newDeviceName;
                        }
                        if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                            filter["scheduledTime"] = ok.schema_model.scheduledTime;
                        }
                        this.service.rescheduleAll(filter,ok.schema_model.selectedExporter).subscribe((res)=>{
                            this.cfpLoadingBar.complete();
                            if(_.hasIn(res,"count")){
                                this.mainservice.showMsg($localize `:@@tasks_rescheduled_param:${res.count}:@@count: tasks rescheduled successfully!`);
                            }else{
                                this.mainservice.showMsg($localize `:@@tasks_rescheduled:Tasks rescheduled successfully!`);
                            }
                        }, (err) => {
                            this.cfpLoadingBar.complete();
                            this.httpErrorHandler.handleError(err);
                        });
                    }
                    this.allAction = "";
                    this.allAction = undefined;
                });
                break;
            case "mark4export":
                this.mark4exportMultipleDevicesDialog((ok)=>{
                    if (ok) {
                        this.cfpLoadingBar.start();
                        if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                            filter["newDeviceName"] = ok.schema_model.newDeviceName;
                        }
                        if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                            filter["scheduledTime"] = ok.schema_model.scheduledTime;
                        }
                        this.service.mark4exportAll(filter,ok.schema_model.selectedExporter).subscribe((res)=>{
                            this.cfpLoadingBar.complete();
                            if(_.hasIn(res,"count")){
                                this.mainservice.showMsg($localize `:@@tasks_marked_for_export_param:${res.count}:@@count: tasks marked for export successfully!`);
                            }else{
                                this.mainservice.showMsg($localize `:@@tasks_marked_for_export:Tasks marked for export successfully!`);
                            }
                        }, (err) => {
                            this.cfpLoadingBar.complete();
                            this.httpErrorHandler.handleError(err);
                        });
                    }
                    this.allAction = "";
                    this.allAction = undefined;
                });
                break;
            case "delete":
                this.confirm({
                    content: text
                }).subscribe((ok)=>{
                    if(ok){
                        this.cfpLoadingBar.start();
                        this.service.deleteAll(filter).subscribe((res)=>{
                            this.cfpLoadingBar.complete();
                            if(_.hasIn(res,"deleted")){
                                this.mainservice.showMsg($localize `:@@task_deleted:${res.deleted} tasks deleted successfully!`);
                            }else{
                                this.mainservice.showMsg($localize `:@@tasks_deleted:Tasks deleted successfully!`);
                            }
                        }, (err) => {
                            this.cfpLoadingBar.complete();
                            this.httpErrorHandler.handleError(err);
                        });
                    }
                    this.allAction = "";
                    this.allAction = undefined;
                });
                break;
            default:
                this.allAction = "";
                this.allAction = undefined;
        }
    }
    getDifferenceTime(starttime, endtime,mode?){
        let start = new Date(starttime).getTime();
        let end = new Date(endtime).getTime();
        if (!start || !end || end < start){
            return null;
        }else{
            return this.msToTime(new Date(endtime).getTime() - new Date(starttime).getTime(),mode);
        }
    };
    checkAll(event){
        this.matches.forEach((match)=>{
            match.checked = event.target.checked;
        });
    }
    rescheduleDialog(callBack:Function,  schema_model?:any, title?:string, text?:string){
        this.confirm({
            content: title || $localize `:@@export.task_reschedule:Task reschedule`,
            doNotSave:true,
            form_schema: this.service.getDialogSchema(this.exporters, this.devices, text),
            result: {
                schema_model: schema_model || {}
            },
            saveButton: $localize `:@@SUBMIT:SUBMIT`
        }).subscribe((ok)=>{
                callBack.call(this, ok);
        });
    }
    mark4exportDialog(callBack:Function,  schema_model?:any, title?:string, text?:string){
        this.confirm({
            content: title || $localize `:@@export.task_mark4export:Mark task for export`,
            doNotSave:true,
            form_schema: this.service.getDialogSchemaMark4Export(this.exporters, this.devices, text),
            result: {
                schema_model: schema_model || {}
            },
            saveButton: $localize `:@@SUBMIT:SUBMIT`
        }).subscribe((ok)=>{
            callBack.call(this, ok);
        });
    }
    mark4exportMultipleDevicesDialog(callBack:Function,  schema_model?:any, title?:string, text?:string){
        this.confirm({
            content: title || $localize `:@@export.task_mark4export:Mark task for export`,
            doNotSave:true,
            form_schema: this.service.getDialogSchemaMark4ExportMultipleDevices(this.exporters, this.devices, text),
            result: {
                schema_model: schema_model || {}
            },
            saveButton: $localize `:@@SUBMIT:SUBMIT`
        }).subscribe((ok)=>{
            callBack.call(this, ok);
        });
    }
    executeAll(mode){
        if(mode === "reschedule"){
            this.rescheduleDialog((ok)=>{
                if (ok) {
                    this.cfpLoadingBar.start();
                    let filter  = {};
                    let id;
                    if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                        filter["newDeviceName"] = ok.schema_model.newDeviceName;
                    }
                    if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                        filter["scheduledTime"] = ok.schema_model.scheduledTime;
                    }
                    if(_.hasIn(ok, "schema_model.selectedExporter")){
                        id = ok.schema_model.selectedExporter;
                    }
                    this.matches.forEach((match, i)=>{
                        if(match.checked){
                            this.service.reschedule(match.properties.pk, id || match.properties.ExporterID, filter)
                                .subscribe(
                                    (res) => {
                                        this.mainservice.showMsg($localize `:@@task_rescheduled_param:Task ${match.properties.pk}:@@taskid: rescheduled successfully!`);
                                        if(this.matches.length === i+1){
                                            this.cfpLoadingBar.complete();
                                        }
                                    },
                                    (err) => {
                                        this.httpErrorHandler.handleError(err);
                                        if(this.matches.length === i+1){
                                            this.cfpLoadingBar.complete();
                                        }
                                    });
                        }
                        if(this.matches.length === i+1){
                            this.cfpLoadingBar.complete();
                        }
                    });
                }
                this.allAction = "";
                this.allAction = undefined;
            });
            ////
        } else if(mode === "mark4export"){
            this.mark4exportDialog((ok)=>{
                if (ok) {
                    this.cfpLoadingBar.start();
                    let filter  = {};
                    let id;
                    if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                        filter["newDeviceName"] = ok.schema_model.newDeviceName;
                    }
                    if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                        filter["scheduledTime"] = ok.schema_model.scheduledTime;
                    }
                    if(_.hasIn(ok, "schema_model.selectedExporter")){
                        id = ok.schema_model.selectedExporter;
                    }
                    this.matches.forEach((match, i)=>{
                        if(match.checked){
                            this.service.mark4export(match.properties.pk, id || match.properties.ExporterID, filter)
                                .subscribe(
                                    (res) => {
                                        this.mainservice.showMsg($localize `:@@task_marked_for_export_param:Task ${match.properties.pk}:@@taskid: marked for export successfully!`);
                                        if(this.matches.length === i+1){
                                            this.cfpLoadingBar.complete();
                                        }
                                    },
                                    (err) => {
                                        this.httpErrorHandler.handleError(err);
                                        if(this.matches.length === i+1){
                                            this.cfpLoadingBar.complete();
                                        }
                                    });
                        }
                        if(this.matches.length === i+1){
                            this.cfpLoadingBar.complete();
                        }
                    });
                }
                this.allAction = "";
                this.allAction = undefined;
            });
            ////
        } else {
            this.confirm({
                content: $localize `:@@action_selected_entries_question:Are you sure you want to ${Globalvar.getActionText(mode)} selected entries?`
            }).subscribe(result => {
                if (result){
                    this.cfpLoadingBar.start();
                    this.matches.forEach((match)=>{
                        if(match.checked){
                            this.service[mode](match.properties.pk)
                                .subscribe((res) => {
                                    console.log("Execute result",res);
                                },(err)=>{
                                    this.httpErrorHandler.handleError(err);
                                });
                        }
                    });
                    setTimeout(()=>{
                        this.search(this.matches[0].offset || 0);
                        this.cfpLoadingBar.complete();
                    },300);

                }
            });
        }
    }
    msToTime(duration,mode?) {
        if(mode)
            if(mode === "sec")
                return ((duration*6 / 6000).toFixed(4)).toString() + ' s';
        else
            return ((duration / 60000).toFixed(4)).toString() + ' min';
    }
    deleteBatchedTask(batchedTask){
        this.confirm({
            content: $localize `:@@task_delete_question:Are you sure you want to delete all tasks to this batch?`
        }).subscribe(ok=>{
            if(ok){
                if(batchedTask.properties.batchID){
                    let filter = Object.assign({},this.filterObject);
                    filter["batchID"] = batchedTask.properties.batchID;
                    delete filter["limit"];
                    delete filter["offset"];
                    this.service.deleteAll(filter).subscribe((res)=>{
                        this.mainservice.showMsg($localize `:@@task_deleted_param:${res.deleted}:@@deleted: tasks deleted successfully!`);
                        this.cfpLoadingBar.complete();
                        this.search(0);
                    }, (err) => {
                        this.cfpLoadingBar.complete();
                        this.httpErrorHandler.handleError(err);
                    });
                }else{
                    this.mainservice.showError($localize `:@@batch_id_not_found:Batch ID not found!`);
                }
            }
        });
    }
    delete(match){
        let $this = this;
        let parameters: any = {
            content: $localize `:@@delete_task_question:Are you sure you want to delete this task?`,
            result: {
                select: this.exporters[0].id
            },
            saveButton: $localize `:@@DELETE:DELETE`
        };
        this.confirm(parameters).subscribe(result => {
            if (result){
                $this.cfpLoadingBar.start();
                this.service.delete(match.properties.pk)
                    .subscribe(
                        (res) => {
                            // match.properties.status = 'CANCELED';
                            $this.cfpLoadingBar.complete();
                            $this.search(0);
                            this.mainservice.showMsg($localize `:@@task_deleted:Task deleted successfully!`)
                        },
                        (err) => {
                            $this.cfpLoadingBar.complete();
                            $this.httpErrorHandler.handleError(err);
                        });
                }
        });
    }
    cancel(match) {
        let $this = this;
        let parameters: any = {
            content: $localize `:@@want_to_cancel_this_task:Are you sure you want to cancel this task?`,
            result: {
                select: this.exporters[0].id
            },
            saveButton: $localize `:@@YES:YES`
        };
        this.confirm(parameters).subscribe(result => {
            if (result){
                $this.cfpLoadingBar.start();
                this.service.cancel(match.properties.pk)
                    .subscribe(
                        (res) => {
                            match.properties.status = 'CANCELED';
                            $this.cfpLoadingBar.complete();
                            this.mainservice.showMsg($localize `:@@task_canceled:Task canceled successfully!`)
                        },
                        (err) => {
                            $this.cfpLoadingBar.complete();
                            console.log('cancleerr', err);
                            $this.httpErrorHandler.handleError(err);
                        });
            }
        });
    };
    reschedule(match) {
        this.rescheduleDialog((ok)=>{
            if (ok) {
                this.cfpLoadingBar.start();
                let filter  = {};
                let id;
                if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                    filter["newDeviceName"] = ok.schema_model.newDeviceName;
                }
                if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                    filter["scheduledTime"] = ok.schema_model.scheduledTime;
                }
                if(_.hasIn(ok, "schema_model.selectedExporter")){
                    id = ok.schema_model.selectedExporter;
                }
                this.service.reschedule(match.properties.pk, id || match.properties.ExporterID, filter)
                    .subscribe(
                        (res) => {
                            this.cfpLoadingBar.complete();
                            if(_.hasIn(res,"count")){
                                this.mainservice.showMsg($localize `:@@tasks_rescheduled_param:${res.count}:@@count: tasks rescheduled successfully!`);
                            }else{
                                this.mainservice.showMsg($localize `:@@task_rescheduled:Task rescheduled successfully!`);

                            }
                        },
                        (err) => {
                            this.cfpLoadingBar.complete();
                            this.httpErrorHandler.handleError(err);
                        });

            }
        },
        {
            selectedExporter: match.properties.ExporterID
        },
        undefined,
        $localize `:@@export.change_the_exporter_id_only_if_you_want:Change the Exporter Id only if you want to reschedule to another exporter!`
        );
    };
    mark4export(match) {
        this.mark4exportDialog((ok)=>{
                if (ok) {
                    this.cfpLoadingBar.start();
                    let filter  = {};
                    let id;
                    if(_.hasIn(ok, "schema_model.newDeviceName") && ok.schema_model.newDeviceName != ""){
                        filter["newDeviceName"] = ok.schema_model.newDeviceName;
                    }
                    if(_.hasIn(ok, "schema_model.scheduledTime") && ok.schema_model.scheduledTime != ""){
                        filter["scheduledTime"] = ok.schema_model.scheduledTime;
                    }
                    if(_.hasIn(ok, "schema_model.selectedExporter")){
                        id = ok.schema_model.selectedExporter;
                    }
                    this.service.mark4export(match.properties.pk, id || match.properties.ExporterID, filter)
                        .subscribe(
                            (res) => {
                                this.cfpLoadingBar.complete();
                                if(_.hasIn(res,"count")){
                                    this.mainservice.showMsg($localize `:@@tasks_marked_for_export_param:${res.count}:@@count: tasks marked for export successfully!`);
                                }else{
                                    this.mainservice.showMsg($localize `:@@task_marked_for_export:Task marked for export successfully!`);

                                }
                            },
                            (err) => {
                                this.cfpLoadingBar.complete();
                                this.httpErrorHandler.handleError(err);
                            });

                }
            },
            {
                selectedExporter: match.properties.ExporterID
            },
            undefined,
            $localize `:@@export.change_the_exporter_id_only_if_you_want_mark4export:Change the Exporter Id only if you want to mark for export to another exporter!`
        );
    };

    hasOlder(objs) {
        return objs && (objs.length === this.filterObject.limit);
    };
    hasNewer(objs) {
        return objs && objs.length && objs[0].offset;
    };
    newerOffset(objs) {
        return Math.max(0, objs[0].offset - this.filterObject.limit);
    };
    olderOffset(objs) {
        return objs[0].offset + this.filterObject.limit;
    };

    initExporters(retries) {
        let $this = this;
        this.$http.get(`${j4care.addLastSlash(this.mainservice.baseUrl)}export`)

            .subscribe(
                (res) => {
                    $this.exporters = res;
                    if (res && res[0] && res[0].id){
                        $this.exporterID = res[0].id;
                    }
                    $this.getDevices();
                    // $this.mainservice.setGlobal({exporterID:$this.exporterID});
                },
                (res) => {
                    if (retries)
                        $this.initExporters(retries - 1);
                });
    }
    getDevices(){
        this.cfpLoadingBar.start();
        this.service.getDevices().subscribe(devices=>{
            this.cfpLoadingBar.complete();
            this.devices = devices.filter(dev => dev.hasArcDevExt);
            this.initSchema();
        },(err)=>{
            this.cfpLoadingBar.complete();
            console.error("Could not get devices",err);
        });
    }
    getAets(){
        this.aeListService.getAets()
            .pipe(map(aet=> this.permissionService.filterAetDependingOnUiConfig(aet,'internal')))
            .subscribe(aets=>{
                this.aets = aets.map(ae=>{
                    return {
                        value:ae.dicomAETitle,
                        text:ae.dicomAETitle
                    }
                })
            },(err)=>{
                console.error("Could not get aets",err);
            });
    }
    ngOnDestroy(){
        if(this.timer.started){
            this.timer.started = false;
            clearInterval(this.refreshInterval);
        }
    }
}
