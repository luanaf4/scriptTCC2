var waveconfig = {
    debug: false,
    extensionUrl: "",
    platform: "extension",
    browser: "chrome"
};
var cs = {
	vars: {},
	func: {},
	msg: {
		toBackground: null,
		fromBackground: null
	},
	init: function () {
		cs.func.setEventListeners();
		cs.func.setMessageListeners();
	}
}


cs.func.setupAndDispatchEvent = function (eventName, eventDataObject) {
	var eventData =  {
		"detail": (eventDataObject !== null && typeof eventDataObject === 'object') ? JSON.stringify(eventDataObject) : eventDataObject
	};

	var event = new CustomEvent(eventName, eventData);

	//console.log("cs event setup and fired: " + eventName);
	//console.log(eventData);
	document.dispatchEvent(event);
};


cs.func.setEventListeners = function () {
	//Document Event Listeners
	document.addEventListener("waveResults", function (message) {
		cs.func.sendToBackground("waveResults", message.detail.data);
	});

	document.addEventListener("getExtensionUrl", function() {
		var extensionUrl = chrome.runtime.getURL("");
		cs.func.setupAndDispatchEvent("setExtensionUrl", extensionUrl);
		cs.func.sendToBackground("setExtensionUrl", extensionUrl);
	});
	
	document.addEventListener("handleOutlineData", function (message) {
		cs.func.sendToBackground("handleOutlineData", message.detail.data);
	});
	document.addEventListener("handleNavData", function (message) {
		cs.func.sendToBackground("handleNavData", message.detail.data);
	});
	document.addEventListener("moreInfo", function (message) {
		cs.func.sendToBackground("moreInfo", message.detail.data);
	});
	document.addEventListener("iconList", function (message) {
		cs.func.sendToBackground("iconList", message.detail.data);
	});
	document.addEventListener("setSidebarContrastDetails", function (message) {
		cs.func.sendToBackground("setSidebarContrastDetails", message.detail.data);
	});
	document.addEventListener("showacsbalert", function (message) {
		cs.func.sendToBackground("showacsbalert", message.detail.data);
	});

	//Window Event Listeners
	window.addEventListener("beforeunload", function (e) {
		cs.func.sendToBackground("manualRefresh", {});
		return null;
	});
	window.addEventListener("load", function (e) {
		cs.func.sendToBackground("manualRefresh", {});
	});
	
}

cs.func.setMessageListeners = function () {
	chrome.runtime.onConnect.addListener(function (port) {
		cs.msg.fromBackground = port;
		cs.msg.fromBackground.onMessage.addListener(function (message, sender) {
			if (message.name == "backgroundToCs") {
				  cs.func.setupAndDispatchEvent(message.action, message.data);
			}
		});
	});
}

cs.func.sendToBackground = function (action, data) {
	//console.log("CS sendToBackground: Action: " + action + ", Data: " + data);
	if (cs.msg.toBackground == null) {
		cs.msg.toBackground = chrome.runtime.connect({ name: "csToBackground" });
	}
	cs.msg.toBackground.postMessage({"action": action, "data": data });
}

cs.init();