(function(){

    'use strict';
    angular.module('ones', [
            'ngCookies',
            'ngResource',
            'ngSanitize',
            'ngRoute',
            'ngAnimate',
            'mgcrea.ngStrap',
            'localytics.directives', //FOR CHOSEN
            'ui.utils',
            'ones.gridView',

            'angularFileUpload',

            "ones.pluginsModule",
            "ones.print",

            '[ones.requirements.placeholder]',

            'ones.common',
            'ones.common.services',
            'ones.configModule',
            'ones.commonView' //需要先加载模块，让模块路由优先匹配
        ])
        /**
         * $http interceptor.
         * On 401 response – it stores the request and broadcasts 'event:loginRequired'.
         */
        .config(["$httpProvider", "$locationProvider", function($httpProvider, $locationProvider) {

            var reqInterceptor = ['$q', '$cacheFactory', '$timeout', '$rootScope', function ($q, $cacheFactory, $timeout, $rootScope) {

                $rootScope.dataQuering = 0;

                return {
                    'request': function(config) {
                        $rootScope.dataQuering++;
                        return config;
                    },

                    'response': function(response) {
                        $rootScope.dataQuering--;
                        if (parseInt(response.data.error) > 0) {
                            $rootScope.$broadcast('event:serverError', response.data.msg);
                            return $q.reject(response);
                        } else {
                            return response;
                        }

                        return response;
                    },

                    'responseError': function(response) {
                        var status = response.status;
                        switch(status) {
                            case 401:
                                $rootScope.$broadcast('event:loginRequired', response.data);
                                break;
                            case 403:
                                $rootScope.$broadcast('event:permissionDenied', response.data);
                                break;
                            case 500:
                                $rootScope.$broadcast('event:serverError', response.data);
                                break;
                            default:
                                break;
                        };
                        $rootScope.dataQuering = false;
                        return $q.reject(response);
                    }
                };
            }];

//            $locationProvider.html5Mode(true);
//            $locationProvider.hashPrefix('!');

            $httpProvider.interceptors.push(reqInterceptor);
        }])
        /**
         * Root Ctrl
         * */
        .controller('MainCtl', ["$scope", "$rootScope", "$location", "$http", "ones.config", "ComView", "$timeout", "pluginExecutor", "$injector",
            function($scope, $rootScope, $location, $http, conf, ComView, $timeout, plugin, $injector) {

                setTimeout(function(){
                    if($("#initCover").length) {
                        $("#initCover").fadeOut(function(){
                            $("html").css({
                                height: "auto",
                                overflow: "scroll"
                            });
                            $("#initCover").remove();
                        });
                    }
                }, 2000);

                //左侧是否展开
                var expand = ones.caches.getItem("ones.sidebar.expand");
                $scope.expand = expand;
                $scope.sidebarToggleExpand = function() {
                    $scope.expand = !$scope.expand;
                    ones.caches.setItem("ones.sidebar.expand", $scope.expand, 1);
                }

                //有需要的APP未能加载
                if(ones.unfoundApp) {
                    ComView.alert(
                        sprintf($rootScope.i18n.lang.messages.unfoundApp, ones.unfoundApp.join()),
                        "danger",
                        "!",
                        false);
                    $scope.unfoundApp = ones.unfoundApp;
                }

                $scope.onesConf = conf;
                $scope.BSU = conf.BSU;
                $scope.BSURoot = conf.BSURoot;
                if(!$scope.BSURoot) {
                    var tmp = conf.BSU.split("/").slice(0, -2);
                    $scope.BSURoot = tmp.join("/");
                }

                $scope.$watch(function() {
                    return $location.path();
                }, function() {
                    $scope.currentURI = encodeURI(encodeURIComponent($location.$$url));
                });

                //监听全局事件
                $scope.$on("event:loginRequired", function() {
                    window.location.reload();
                });

                $scope.$on("event:permissionDenied", function(evt, msg) {
                    msg = ComView.toLang("permissionDenied", "messages") + ComView.toLang(msg, "messages");
                    ComView.alert(msg, "danger");
                });

                $scope.$on("event:serverError", function(evt, msg) {
                    msg = ComView.toLang(msg || "serverError", "messages");
                    ComView.alert(msg, "danger");
                });

                //刷新NG-VIEW
                $scope.doPageRefresh = function(){
                    if($rootScope.currentPage.action === "list") {
                        $scope.$broadcast("gridData.refreshed");
                    }
                };

                //全局键盘事件
                $scope.doMainKeyDown = function($event){
                    //back space
                    if($event.keyCode === 8) {
                        var skips = [
                            "input",
                            "textarea"
                        ];
                        if(skips.indexOf($($event.target).context.localName) >= 0) {
                            return true;
                        }
                        window.event.returnValue = false;
                        return false;
                    }

                    plugin.callPlugin("hook.hotKey", $event);
                };

                //历史
                var pathHistory = function(){
                    this.back = function(){};
                    this.forward = function() {};
                    this.go =function() {};

                    this.getHistories = function() {
                        return ones.caches.getItem("ones.pathHistory");
                    };

                    this.setHistories = function() {
                        var histories = this.getHistories();
                        histories.push($location.path());
                        ones.caches.setItem("ones.pathHistory", histories, -1);
                    };

                    this._historys = [];
                };
                var ph = new pathHistory();

//                console.log(ph.getHistories());

                $scope.isAppLoaded = function(app) {
                    return isAppLoaded(app);
                }

                $scope.isPrimaryApp = function(app) {
                    return ['dashboard','department', 'services', 'multiSearch'].indexOf(app) >=0 ? true : false;
                }

                /**
                 * 监控路由变化
                 * */
                 var lastPage = [];
                 $rootScope.$on("$locationChangeSuccess", function() {
                    doWhenLocationChanged();

                    $('body,html').animate({scrollTop:0},300);

//                    var lastPage = ones.caches.getItem("pageHistory");

                    lastPage[0] = lastPage[1];
                    lastPage[1] = $location.path();
                    ones.caches.setItem("lastPage", lastPage, -1);
                });

                function doWhenLocationChanged() {
                    /**
                     * 设置当前页面信息
                     * 两种URL模式： 普通模式 app/module/action
                     *             URL友好模式 app/action(list|add|edit)/module
                     * */
                    var actionList = ['list', 'listAll', 'export', 'add', 'edit', 'addChild', 'viewChild', 'viewDetail', 'print', 'trash'];
                    var fullPath, app, module, action;
                    fullPath = $location.path().split("/").slice(1, 4);
                    if (!fullPath[1]) {
                        return;
                    }
                    app = fullPath[0];
                    fullPath[1] = fullPath[1].replace(/Bill/ig, ''); //将addBill, editBill转换为普通add,edit
                    //友好模式
                    if (actionList.indexOf(fullPath[1]) >= 0) {
                        module = fullPath[2].ucfirst();
                        action = fullPath[1];
                    } else {
                        module = fullPath[1];
                        action = fullPath[2];
                    }

                    app = app ? app : "HOME";
                    module = module ? module : "Index";
                    action = action && isNaN(parseInt(action)) ? action : "list";
//                        console.log(module);
                    $scope.currentPage = {
                        lang: {}
                    };
                    var urlmap = $rootScope.i18n.urlMap;
                    if (urlmap[app]) {
                        $scope.currentPage.lang.app = urlmap[app].name;
                        if (urlmap[app].modules[module]) {
                            $scope.currentPage.lang.module = urlmap[app].modules[module].name;
                            if (urlmap[app].modules[module].actions[action]) {
                                $scope.currentPage.lang.action = urlmap[app].modules[module].actions[action] instanceof Array
                                    ? urlmap[app].modules[module].actions[action][0]
                                    : urlmap[app].modules[module].actions[action];
                                $scope.currentPage.lang.actionDesc = urlmap[app].modules[module].actions[action] instanceof Array
                                    ? urlmap[app].modules[module].actions[action][1] : "";
                            }
                            if (!$scope.currentPage.lang.action) {
                                $scope.currentPage.lang.action = urlmap[app].modules[module].name;
                                $scope.currentPage.lang.actionDesc = $rootScope.i18n.lang.actions[action];
                            }
                        }
                    }

                    /**
                     * 设定当前APP信息
                     * current location info
                     * */
                    $scope.currentPage.app = app;
                    $scope.currentPage.action = action;
                    $scope.currentPage.module = module;
                    $rootScope.currentPage = $scope.currentPage;

//                    console.log($rootScope.currentPage);

                    /**
                     * 搜索框自动获得焦点
                     * */
                    $timeout(function(){
                        $("#gridSearchInput").focus();
                    }, 500);

                    /**
                     * 清除即时缓存
                     * */
                     ones.caches.clear(-1);
                  }

                doWhenLocationChanged();


                /**
                 * 获取页面基本信息
                 * @return {
                 *  user: {},
                 *  navs: {}
                 * }
                 * */
                $http.get(conf.BSU + "home/index/0.json").success(function(data) {
                    $scope.$broadcast("initDataLoaded", data);
                });

                $scope.$on("initDataLoaded", function(event, data) {
                    $scope.authedNodes = data.authed;
                });

                $scope.userInfo = ones.userInfo;

            }])
    ;
})();
