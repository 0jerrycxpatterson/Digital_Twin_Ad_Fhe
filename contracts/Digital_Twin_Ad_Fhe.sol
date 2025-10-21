pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DigitalTwinAdFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatch();
    error InvalidArgument();
    error ReplayAttempt();
    error StateMismatch();
    error ProofVerificationFailed();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event TwinCreated(address indexed owner, uint256 indexed batchId, uint256 twinId);
    event AdTestSubmitted(address indexed provider, uint256 indexed batchId, uint256 testId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 score);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Twin {
        euint32 interestA;
        euint32 interestB;
        euint32 interestC;
    }

    struct AdTest {
        euint32 adFeatureX;
        euint32 adFeatureY;
        euint32 adFeatureZ;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchOpen;
    mapping(uint256 => uint256) public batchTwinCount;
    mapping(uint256 => uint256) public batchAdTestCount;
    mapping(uint256 => mapping(uint256 => Twin)) public batchTwins;
    mapping(uint256 => mapping(uint256 => AdTest)) public batchAdTests;

    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60;
        currentBatchId = 1;
        isBatchOpen[currentBatchId] = true;
        emit ProviderAdded(owner);
        emit BatchOpened(currentBatchId);
    }

    function addProvider(address _provider) external onlyOwner {
        if (_provider == address(0)) revert InvalidArgument();
        if (!isProvider[_provider]) {
            isProvider[_provider] = true;
            emit ProviderAdded(_provider);
        }
    }

    function removeProvider(address _provider) external onlyOwner {
        if (isProvider[_provider]) {
            isProvider[_provider] = false;
            emit ProviderRemoved(_provider);
        }
    }

    function setPause(bool _paused) external onlyOwner {
        if (_paused != paused) {
            paused = _paused;
            if (paused) {
                emit Paused(msg.sender);
            } else {
                emit Unpaused(msg.sender);
            }
        }
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        if (_cooldownSeconds == 0) revert InvalidArgument();
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, cooldownSeconds);
    }

    function openBatch() external onlyOwner {
        currentBatchId++;
        isBatchOpen[currentBatchId] = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner {
        if (!isBatchOpen[currentBatchId]) revert InvalidBatch();
        isBatchOpen[currentBatchId] = false;
        emit BatchClosed(currentBatchId);
    }

    function createTwin(
        euint32 _interestA,
        euint32 _interestB,
        euint32 _interestC
    ) external whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (!isBatchOpen[currentBatchId]) revert InvalidBatch();

        lastSubmissionTime[msg.sender] = block.timestamp;

        uint256 newTwinId = batchTwinCount[currentBatchId] + 1;
        batchTwinCount[currentBatchId] = newTwinId;
        batchTwins[currentBatchId][newTwinId] = Twin(_interestA, _interestB, _interestC);

        emit TwinCreated(msg.sender, currentBatchId, newTwinId);
    }

    function submitAdTest(
        euint32 _adFeatureX,
        euint32 _adFeatureY,
        euint32 _adFeatureZ
    ) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (!isBatchOpen[currentBatchId]) revert InvalidBatch();

        lastSubmissionTime[msg.sender] = block.timestamp;

        uint256 newTestId = batchAdTestCount[currentBatchId] + 1;
        batchAdTestCount[currentBatchId] = newTestId;
        batchAdTests[currentBatchId][newTestId] = AdTest(_adFeatureX, _adFeatureY, _adFeatureZ);

        emit AdTestSubmitted(msg.sender, currentBatchId, newTestId);
    }

    function requestBatchScoreCalculation(uint256 _batchId) external whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (isBatchOpen[_batchId]) revert InvalidBatch(); 
        if (batchTwinCount[_batchId] == 0 || batchAdTestCount[_batchId] == 0) revert InvalidBatch();

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 score = FHE.asEuint32(0);
        uint256 numTests = batchAdTestCount[_batchId];

        for (uint256 twinId = 1; twinId <= batchTwinCount[_batchId]; twinId++) {
            Twin storage twin = batchTwins[_batchId][twinId];
            for (uint256 testId = 1; testId <= numTests; testId++) {
                AdTest storage adTest = batchAdTests[_batchId][testId];
                euint32 similarity = _calculateSimilarity(twin, adTest);
                score = FHE.add(score, similarity);
            }
        }
        score = FHE.div(score, FHE.asEuint32(batchTwinCount[_batchId] * numTests));

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(score);

        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, _batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        DecryptionContext memory ctx = decryptionContexts[requestId];

        bytes32[] memory cts = new bytes32[](1);
        euint32 score = _getBatchScoreForVerification(ctx.batchId);
        cts[0] = FHE.toBytes32(score);

        bytes32 currentHash = keccak256(abi.encode(cts, address(this)));
        if (currentHash != ctx.stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert ProofVerificationFailed();

        uint32 cleartextScore = abi.decode(cleartexts, (uint32));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, cleartextScore);
    }

    function _calculateSimilarity(Twin storage twin, AdTest storage adTest) internal view returns (euint32) {
        euint32 diffA = FHE.sub(twin.interestA, adTest.adFeatureX);
        euint32 diffB = FHE.sub(twin.interestB, adTest.adFeatureY);
        euint32 diffC = FHE.sub(twin.interestC, adTest.adFeatureZ);

        euint32 sqDiffA = FHE.mul(diffA, diffA);
        euint32 sqDiffB = FHE.mul(diffB, diffB);
        euint32 sqDiffC = FHE.mul(diffC, diffC);

        euint32 sumSqDiff = FHE.add(FHE.add(sqDiffA, sqDiffB), sqDiffC);
        euint32 maxScore = FHE.mul(FHE.asEuint32(255), FHE.asEuint32(255)); 
        return FHE.sub(maxScore, sumSqDiff);
    }

    function _getBatchScoreForVerification(uint256 _batchId) internal view returns (euint32) {
        euint32 score = FHE.asEuint32(0);
        uint256 numTests = batchAdTestCount[_batchId];
        for (uint256 twinId = 1; twinId <= batchTwinCount[_batchId]; twinId++) {
            Twin storage twin = batchTwins[_batchId][twinId];
            for (uint256 testId = 1; testId <= numTests; testId++) {
                AdTest storage adTest = batchAdTests[_batchId][testId];
                euint32 similarity = _calculateSimilarity(twin, adTest);
                score = FHE.add(score, similarity);
            }
        }
        score = FHE.div(score, FHE.asEuint32(batchTwinCount[_batchId] * numTests));
        return score;
    }
}