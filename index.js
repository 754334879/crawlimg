#!/usr/bin/env node

let request = require('request');
let iconv = require('iconv-lite');
let fs = require('fs');
let path = require('path');
let url = require('url');
// ================ catch exception
process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    // Application specific logging, throwing an error, or other logic here
});

process.on('uncaughtException', (err, origin) => {
    console.log('Unhandled exception at:', origin, 'reason:', err);
});
// ================

let urlPattern = /https?:\/\/.*/;
let startPage = process.argv[2];
let folder = process.argv[3] || process.cwd();
if (!urlPattern.test(startPage)) {
    console.warn('start page pattern error, except a URL, start with http or https');
    return;
}
request({
    url: startPage,
    encoding: null,
    timeout: 30 * 1000
}, function (error, response, body) {
    if (error) {
        console.log('error', error);
        return;
    }
    if (response.statusCode === 200) {
        body = iconv.decode(body, 'gb2312');
        let title = getTitle(body);
        folder += `/${title}`;
        let imgsURL = parseHTMLStr(body);
        getImages(imgsURL);
    }
});

function getTitle(htmlStr) {
    let reg = /<title>([^<]*)<\/title>/;
    let title = htmlStr.match(reg);
    return (title && title[1]) || Date.now();
}

function parseHTMLStr(htmlStr) {
    let reg = /data-src=['"]([^'"]+)['"]/gi;
    // let reg = /src=['"]([^'"]+)['"]/gi;
    let reg2 = /ess-data=['"]([^'"]+)['"]/gi;
    let result = [];
    htmlStr.replace(reg, function (match, url) {
        result.push(url);
        return match;
    })
    htmlStr.replace(reg2, function (match, url) {
        result.push(url);
        return match;
    })
    return result;
}

function crateFolder() {
    return new Promise(resolve => {
        fs.access(folder, (err) => {
            if (err) {
                console.log('folder not exist, so create');
                fs.mkdir(folder, {
                    recursive: true
                }, resolve);
            } else {
                resolve();
                console.log('folder exist');
            }
        })
    })
}

async function getImages(urls) {
    if (!urls || urls.length == 0) {
        console.log('fail to parse urls');
        return;
    }
    await crateFolder();
    // 3个一组进行请求
    let groups = [],
        group = [];
    urls.forEach(item => {
        if (group.length < 4) {
            group.push(item);
        } else {
            groups.push(group);
            group = [];
        }
    });
    statis(0);
    let len = Math.max(groups.length, 2)
    for (let i = 0; i < len; i++) {
        await getImageBatch(groups[i], i);
    }
    statis(1, urls.length);
}

function getImageBatch(imgs = [], groupIndex) {
    let promises = imgs.map((item, index) => {
        return _getImage(item, `${groupIndex}${index}`);
    })
    return Promise.all(promises);
}

// function _getImage(img, index) { }

function _getImage(img, index) {
    let filePath = url
        .parse(img)
        .path;
    let {base: fileName, ext} = path.parse(filePath);
    // fileName = index + fileName; // 没什么用
    if (!ext) {
        fileName += '.gif'; //TODO
    }
    return new Promise((resolve) => {
        request({
            url: img,
            method: 'GET',
            encoding: null,
            timeout: 30 * 1000
        }) //, proxy: 'http://127.0.0.1:8888'
            .on('error', function (err) {
                console.log('request err', img, err);
                statis(3);
                resolve();
            })
            .on('response', function (resp) {
                if (resp.statusCode == 200) {
                    statis(2);
                    console.log('get iamge succ', img);
                } else {
                    statis(3);
                    console.log('get iamge fail', img);
                    resolve();
                }
            })
            .on('end', function (data) {
                console.log('save iamge succ', img);
                statis(4);
                resolve();
            })
            .pipe(fs.createWriteStream(path.join(folder, fileName)));
    })
}

/**
 *
 * @param {*} label: 0-开始 1-结束 2-成功+1 3-失败+1 4-保存成功+1
 * @param {*} length
 */
let startTS = 0,
    endTS = 0,
    succ = 0,
    fail = 0,
    saveCount = 0;
function statis(label) {
    switch (label) {
        case 0:
            startTS = Date.now();
            console.log('start', startTS);
            break;
        case 1:
            endTS = Date.now();
            let dur = ((endTS - startTS) / 1000).toFixed(1);
            console.log(`汇总：耗时${dur}s; 获取图片数量${succ + fail}, 成功${succ}, 失败${fail}; 保存完成${saveCount}`);
            break;
        case 2:
            succ += 1;
            break;
        case 3:
            fail += 1;
            break;
        case 4:
            saveCount += 1;
            break;
        default:
            break;
    }
}