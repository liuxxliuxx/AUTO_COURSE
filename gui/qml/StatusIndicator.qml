import QtQuick

Row {
    id: root

    property string statusText: "就绪"
    property color statusColor: "#7D8795"
    property bool running: false
    property real pulsePhase: 0

    spacing: 10
    height: 30

    SequentialAnimation on pulsePhase {
        running: root.running
        loops: Animation.Infinite
        NumberAnimation { from: 0; to: 1; duration: 760; easing.type: Easing.InOutSine }
        NumberAnimation { from: 1; to: 0; duration: 760; easing.type: Easing.InOutSine }
    }

    Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: 13
        height: 13
        radius: 7
        color: root.statusColor
        scale: root.running ? 1 + root.pulsePhase * 0.28 : 1
        opacity: root.running ? 0.72 + root.pulsePhase * 0.24 : 0.86

        Behavior on color {
            ColorAnimation { duration: 180 }
        }
    }

    Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.statusText
        color: root.statusColor
        elide: Text.ElideRight
        font {
            family: "Microsoft YaHei UI"
            pixelSize: 14
            weight: Font.Medium
        }

        Behavior on color {
            ColorAnimation { duration: 180 }
        }
    }
}
