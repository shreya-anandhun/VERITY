// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title VERITY voting, version 2
/// @notice One wallet, one vote. No owner, no admin, no upgrade, no way to edit a vote.
/// @dev New in v2: size limits on every input, a creation time stored on-chain,
///      and getPolls(offset, limit) so the website can load polls a page at a time.
contract VotingV2 {
    // ---- limits (enforced on every new poll) ----
    uint256 public constant MAX_TITLE = 200;      // bytes
    uint256 public constant MAX_CATEGORY = 32;    // bytes
    uint256 public constant MAX_OPTION = 100;     // bytes per option
    uint256 public constant MIN_OPTIONS = 2;
    uint256 public constant MAX_OPTIONS = 10;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_PAGE = 50;        // polls per getPolls call

    struct Poll {
        string title;
        string category;
        string[] options;
        uint256[] votes;
        address creator;
        uint64 createdAt;
        uint64 endTime;
        bool isOpen;
        uint256 totalVotes;
    }

    /// @dev What getPoll / getPolls return (same fields plus the id)
    struct PollView {
        uint256 id;
        string title;
        string category;
        string[] options;
        uint256[] votes;
        address creator;
        uint64 createdAt;
        uint64 endTime;
        bool isOpen;
        uint256 totalVotes;
    }

    Poll[] private polls;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => uint256)) public votedFor;

    event PollCreated(uint256 indexed pollId, address indexed creator, string title, string category);
    event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex);
    event PollClosed(uint256 indexed pollId);

    modifier exists(uint256 pollId) {
        require(pollId < polls.length, "No such poll");
        _;
    }

    function createPoll(string calldata title, string calldata category, string[] memory options, uint256 endTime)
        external returns (uint256 pollId)
    {
        uint256 t = bytes(title).length;
        require(t > 0 && t <= MAX_TITLE, "Title must be 1 to 200 characters");
        uint256 c = bytes(category).length;
        require(c > 0 && c <= MAX_CATEGORY, "Category must be 1 to 32 characters");
        require(options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS, "2 to 10 options");
        for (uint256 i = 0; i < options.length; i++) {
            uint256 o = bytes(options[i]).length;
            require(o > 0 && o <= MAX_OPTION, "Each option must be 1 to 100 characters");
        }
        require(endTime > block.timestamp, "End time must be in the future");
        require(endTime <= block.timestamp + MAX_DURATION, "Polls can last at most a year");

        pollId = polls.length;
        Poll storage p = polls.push();
        p.title = title;
        p.category = category;
        p.options = options;
        p.votes = new uint256[](options.length);
        p.creator = msg.sender;
        p.createdAt = uint64(block.timestamp);
        p.endTime = uint64(endTime);
        p.isOpen = true;
        emit PollCreated(pollId, msg.sender, title, category);
    }

    function vote(uint256 pollId, uint256 optionIndex) external exists(pollId) {
        Poll storage p = polls[pollId];
        require(p.isOpen && block.timestamp < p.endTime, "Poll is closed");
        require(!hasVoted[pollId][msg.sender], "Already voted");
        require(optionIndex < p.options.length, "No such option");
        hasVoted[pollId][msg.sender] = true;
        votedFor[pollId][msg.sender] = optionIndex;
        p.votes[optionIndex] += 1;
        p.totalVotes += 1;
        emit Voted(pollId, msg.sender, optionIndex);
    }

    /// @notice Only the poll's creator can close it early. Existing votes are never touched.
    function closePoll(uint256 pollId) external exists(pollId) {
        Poll storage p = polls[pollId];
        require(msg.sender == p.creator, "Only the creator can close");
        require(p.isOpen, "Already closed");
        p.isOpen = false;
        emit PollClosed(pollId);
    }

    function pollCount() external view returns (uint256) {
        return polls.length;
    }

    function getPoll(uint256 pollId) external view exists(pollId) returns (PollView memory) {
        return _view(pollId);
    }

    /// @notice Up to MAX_PAGE polls starting at `offset`, oldest first.
    function getPolls(uint256 offset, uint256 limit) external view returns (PollView[] memory page) {
        if (offset >= polls.length) return new PollView[](0);
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 end = offset + limit;
        if (end > polls.length) end = polls.length;
        page = new PollView[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = _view(i);
    }

    /// @notice Just the vote counts: the cheapest way to refresh live results.
    function getVotes(uint256 pollId) external view exists(pollId) returns (uint256[] memory) {
        return polls[pollId].votes;
    }

    function _view(uint256 id) private view returns (PollView memory v) {
        Poll storage p = polls[id];
        v = PollView(id, p.title, p.category, p.options, p.votes, p.creator, p.createdAt, p.endTime, p.isOpen, p.totalVotes);
    }
}
