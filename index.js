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
let tryCount = 0, maxTryCount = 3;
let retryImgs = [], totalImgCount = 0;

let urlPattern = /https?:\/\/.*/;
let startPage = process.argv[2];
let folder = process.argv[3] || process.cwd();
if (!urlPattern.test(startPage)) {
    console.warn('start page pattern error, except a URL, start with http or https');
    return;
}
let descript = {
    title: '',
    url: startPage,
    count: 0,
    statis: ''
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
        descript.title = getTitle(body);
        folder += `/${descript.title.replace('/', '')}`;
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

function checkAndCreateFolder() {
    return new Promise((resolve, reject) => {
        fs.access(folder, (err) => {
            if (err) {
                console.log('folder not exist, so create', folder);
                fs.mkdir(folder, {
                    recursive: true
                }, resolve);
            } else {
                resolve('folder exist. so skip');
                console.log('folder exist');
            }
        })
    })
}

async function getImages(urls) {
    if (!urls || urls.length == 0) {
        console.log('fail to parse urls');
        throw "fail to parse urls";
    }
    descript.count = urls.length;
    await checkAndCreateFolder();
    urls = indexImg(urls);
    statis(0);
    _getImages(urls);
}

async function _getImages(urls) {
    // 4个一组进行请求
    let groups = [],
        group = [];
    urls.forEach(item => {
        group.push(item);
        if (group.length >= 4) {
            groups.push(group);
            group = [];
        }
    });
    group.length > 0 && groups.push(group);
    for (let i = 0; i < groups.length; i++) {
        await getImageBatch(groups[i]);
    }
    afterOneLoop();
}

function afterOneLoop() {
    console.log('check retry', tryCount, retryImgs.length);
    if (retryImgs.length == 0 || tryCount >= maxTryCount) {
        // 结束
        statis(1);
        createREADME();
        return;
    }
    tryCount += 1;
    _getImages(retryImgs.splice(0, retryImgs.length)); //需要传递，并清空 retryImgs
}

function indexImg(urls) {
    let length = String(urls.length).length; //数量级 100-3位
    let repeat = (str, times) => {
        if (times == 0) {
            return '';
        }
        return Array(times).join(',').split(',').reduce((s) => s + String(str), '');
    };
    let padIndex = (index, length) => {
        return repeat('0', length - index.length) + index;
    }
    return urls.map((url, index) => {
        return {
            prefix: padIndex(String(index), length) + '_',
            url
        }
    })
}

function getImageBatch(imgs = []) {
    let promises = imgs.map((item, index) => {
        return _getImage(item);
    })
    return Promise.all(promises);
}

async function _getImage(img) {
    let filePath = url
        .parse(img.url)
        .path;
    let { base: fileName, ext } = path.parse(filePath);
    fileName = img.prefix + fileName;
    if (!ext) {
        fileName += '.gif'; //TODO
    }
    fileName = path.join(folder, fileName);

    let hasImg = await checkIsExist(fileName);
    if (hasImg) {
        console.log('has image and skip', img.url);
        statis(5);
        return;
    }
    return new Promise((resolve) => {
        request({
            url: img.url,
            method: 'GET',
            encoding: null,
            timeout: 30 * 1000
        }) //, proxy: 'http://127.0.0.1:8888'
            .on('error', function (err) {
                console.log('request err', img.url, err);
                statis(3);
                retryImgs.push(img);
                resolve();
            })
            .on('response', function (resp) {
                if (resp.statusCode == 200) {
                    statis(2);
                    console.log('get image succ', img.url);
                } else {
                    statis(3);
                    console.log('get image fail', img.url);
                    resolve();
                }
            })
            .on('end', function (data) {
                console.log('save image succ', img.url);
                statis(4);
                resolve();
            })
            .pipe(fs.createWriteStream(fileName));
    })
}

function checkIsExist(fileName) {
    return new Promise((resolve, reject) => {
        fs.access(fileName, (err) => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        })
    })
}

function createREADME() {
    let { title, url, count, statis } = descript;
    let content = [];
    content.push(`## ${title}`);
    content.push(`[页面](${url})`);
    content.push(`图片数量：\`${count}\``);
    content.push(statis);
    content.push(new Date().toLocaleString());
    fs.createWriteStream(require('path').join(folder, 'README.md')).write(content.join('\n\n'));
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
    saveCount = 0,
    existCount = 0;
function statis(label) {
    switch (label) {
        case 0:
            startTS = Date.now();
            console.log('start', startTS);
            break;
        case 1:
            endTS = Date.now();
            let dur = ((endTS - startTS) / 1000).toFixed(1);
            descript.statis = `汇总：耗时${dur}s; 图片总数量${descript.count}; 已存在数量${existCount}; 保存完成${saveCount}; 获取图片次数${succ + fail}, 成功${succ}, 失败${fail}`;
            console.log(descript.statis);
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
        case 5:
            existCount += 1;
            break;
        default:
            break;
    }
}