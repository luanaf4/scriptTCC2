var inject = {
    vars: {
        JSDetailsArr: [],
        CSSDetailsArr: []
    },
    func: {},
    init: function () {
            inject.func.setDetailsArray();
            inject.func.setCSSArray();
            inject.func.InjectStyles(inject.vars.CSSDetailsArr);
            inject.func.InjectScripts(inject.vars.JSDetailsArr);
    }
}

inject.func.setDetailsArray = function () {
        inject.vars.JSDetailsArr = [
            { file: chrome.runtime.getURL('wave.min.js') }
        ];
}

inject.func.setCSSArray = function () {
    inject.vars.CSSDetailsArr = [
        chrome.runtime.getURL('styles/report-ext.css')
    ];
}

inject.func.injectJs = function (link, callback) {
    if (link.hasOwnProperty('file')) {
        var scr = document.createElement('script');
        scr.src = link.file;
        scr.setAttribute("id", "wavescript");
        document.getElementsByTagName('head')[0].appendChild(scr);
    }
    else if (link.hasOwnProperty('code')) {
        var scr = document.createElement('script');
        scr.innerText = link.code;
        scr.setAttribute("id", "wavescript");
        document.getElementsByTagName('head')[0].appendChild(scr);
    }
    if (callback !== null)
        callback();   // execute outermost function
}

inject.func.InjectScripts = function(injectDetailsArray) {
    //creates callbacks automatically to avoid a big chained structure.
    function createCallback(injectDetails, innerCallback) {
        return function () {
            inject.func.injectJs(injectDetails, innerCallback);
        };
    }

    var callback = null;

    for (var i = injectDetailsArray.length - 1; i >= 0; --i)
        callback = createCallback(injectDetailsArray[i], callback);

    if (callback !== null)
        callback();   // execute outermost function
};
    
inject.func.injectCSS = function(link, callback) {
    var scr = document.createElement('link');
    scr.href = link;
    scr.rel = "stylesheet";
    scr.setAttribute("id", "wavestyle");
    document.getElementsByTagName('head')[0].appendChild(scr)
    if (callback !== null)
        callback();   // execute outermost function
}

inject.func.InjectStyles = function(injectDetailsArray) {
    //creates callbacks automatically to avoid a big chained structure.
    function createCallback(injectDetails, innerCallback) {
        return function () {
            inject.func.injectCSS(injectDetails, innerCallback);
        };
    }

    var callback = null;

    for (var i = injectDetailsArray.length - 1; i >= 0; --i)
        callback = createCallback(injectDetailsArray[i], callback);

    if (callback !== null)
        callback();   // execute outermost function
}

inject.init();