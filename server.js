const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// JSON 바디 파싱
app.use(express.json());

// 정적 파일 제공
app.use(express.static('public'));

// HTML 파일 제공
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/index.html'));
});

// SSE 클라이언트 관리
const clients = new Set();

// 경매 상태
const auctionState = {
  itemName: '희귀 빈티지 시계',
  startPrice: 100000,
  currentPrice: 100000,
  highestBidder: null,
  timeLeft: 30,
  isRunning: false,
  bidHistory: [],
  timerId: null,
};

// 모든 SSE 클라이언트에게 이벤트 전송
function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => {
    res.write(payload);
  });
}

// 경매 상태 브로드캐스트
function broadcastAuctionState() {
  broadcast('auctionState', {
    itemName: auctionState.itemName,
    startPrice: auctionState.startPrice,
    currentPrice: auctionState.currentPrice,
    highestBidder: auctionState.highestBidder,
    timeLeft: auctionState.timeLeft,
    isRunning: auctionState.isRunning,
    bidHistory: auctionState.bidHistory,
  });
}

// 경매 시작
function startAuction() {
  if (auctionState.isRunning) return;

  auctionState.isRunning = true;
  auctionState.timeLeft = 30;
  auctionState.currentPrice = auctionState.startPrice;
  auctionState.highestBidder = null;
  auctionState.bidHistory = [];

  // 전체 상태 브로드캐스트
  broadcastAuctionState();

  // 1초마다 카운트다운
  auctionState.timerId = setInterval(() => {
    auctionState.timeLeft--;

    // 타이머 업데이트 전송
    broadcast('timerUpdate', {
      timeLeft: auctionState.timeLeft,
    });

    if (auctionState.timeLeft <= 0) {
      // 경매 종료
      clearInterval(auctionState.timerId);
      auctionState.timerId = null;
      auctionState.isRunning = false;

      // 경매 종료 이벤트 전송
      broadcast('auctionEnd', {
        winner: auctionState.highestBidder,
        finalPrice: auctionState.currentPrice,
        itemName: auctionState.itemName,
      });
    }
  }, 1000);
}

// SSE 엔드포인트
app.get('/events', (req, res) => {
  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 클라이언트 등록
  clients.add(res);

  // 초기 연결 메시지
  res.write('data: {"message": "연결되었습니다"}\n\n');

  // 현재 경매 상태 전송
  const statePayload = `event: auctionState\ndata: ${JSON.stringify({
    itemName: auctionState.itemName,
    startPrice: auctionState.startPrice,
    currentPrice: auctionState.currentPrice,
    highestBidder: auctionState.highestBidder,
    timeLeft: auctionState.timeLeft,
    isRunning: auctionState.isRunning,
    bidHistory: auctionState.bidHistory,
  })}\n\n`;
  res.write(statePayload);

  // 연결 종료 시 클라이언트 제거
  req.on('close', () => {
    clients.delete(res);
    console.log('클라이언트 연결 종료');
  });
});

// 경매 시작 엔드포인트
app.post('/start', (req, res) => {
  if (auctionState.isRunning) {
    return res.json({ success: false, message: '경매가 이미 진행 중입니다.' });
  }
  startAuction();
  res.json({ success: true, message: '경매가 시작되었습니다.' });
});

// 입찰 엔드포인트
app.post('/bid', (req, res) => {
  const { username, amount } = req.body;

  // 유효성 검사
  if (!auctionState.isRunning) {
    return res.json({ success: false, message: '경매가 진행 중이 아닙니다.' });
  }

  if (!username || username.trim() === '') {
    return res.json({ success: false, message: '이름을 입력해주세요.' });
  }

  const bidAmount = parseInt(amount);
  if (isNaN(bidAmount) || bidAmount <= auctionState.currentPrice) {
    return res.json({
      success: false,
      message: `현재 최고가(${auctionState.currentPrice.toLocaleString()}원)보다 높은 금액을 입력해주세요.`,
    });
  }

  // 입찰 성공
  auctionState.currentPrice = bidAmount;
  auctionState.highestBidder = username.trim();

  // 입찰 내역 추가
  const bidRecord = {
    username: username.trim(),
    amount: bidAmount,
    timestamp: new Date().toISOString(),
  };
  auctionState.bidHistory.unshift(bidRecord);

  // 전체 상태 브로드캐스트
  broadcastAuctionState();

  // 새 입찰 알림 브로드캐스트
  broadcast('newBid', {
    username: username.trim(),
    amount: bidAmount,
    timestamp: bidRecord.timestamp,
  });

  res.json({ success: true, message: '입찰이 완료되었습니다.' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`경매 서버가 포트 ${PORT}에서 실행 중입니다`);
});
