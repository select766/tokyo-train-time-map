
import * as $ from 'jquery';
import * as Snap from 'snapsvg';
$(() => {
    console.log('loaded');
});
(<any>window)["s"] = Snap;
console.log('Hello world');
