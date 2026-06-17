import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property bool running: false
    property color startColor: "#172033"
    property color stopColor: "#C73E44"

    signal clicked()

    implicitWidth: 172
    implicitHeight: 50
    width: implicitWidth
    height: implicitHeight
    opacity: enabled ? 1 : 0.46
    scale: mouse.pressed && enabled ? 0.985 : 1

    Behavior on scale {
        NumberAnimation { duration: 120; easing.type: Easing.OutCubic }
    }
    Behavior on opacity {
        NumberAnimation { duration: 140; easing.type: Easing.OutCubic }
    }

    Rectangle {
        anchors.fill: parent
        anchors.topMargin: 5
        radius: 17
        color: root.running ? "#22C73E44" : "#22172033"
        visible: mouse.containsMouse || root.running
    }

    Rectangle {
        id: face
        anchors.fill: parent
        radius: 16
        color: !root.enabled ? "#B8C1CD" : (root.running ? root.stopColor : root.startColor)
        border.width: 1
        border.color: root.running ? "#F0A6AA" : "#455266"

        Behavior on color {
            ColorAnimation { duration: 160 }
        }
    }

    Rectangle {
        anchors.fill: parent
        anchors.margins: 1
        radius: 15
        color: mouse.containsMouse && root.enabled ? "#12FFFFFF" : "#00FFFFFF"
        Behavior on color {
            ColorAnimation { duration: 120 }
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 17
        anchors.rightMargin: 18
        spacing: 10

        Canvas {
            id: icon
            Layout.preferredWidth: 18
            Layout.preferredHeight: 18

            onPaint: {
                var ctx = getContext("2d")
                ctx.clearRect(0, 0, width, height)
                ctx.fillStyle = "#F8FFFFFF"
                if (root.running) {
                    ctx.fillRect(4, 4, 10, 10)
                } else {
                    ctx.beginPath()
                    ctx.moveTo(5, 3)
                    ctx.lineTo(5, 15)
                    ctx.lineTo(15, 9)
                    ctx.closePath()
                    ctx.fill()
                }
            }

            Connections {
                target: root
                function onRunningChanged() { icon.requestPaint() }
                function onEnabledChanged() { icon.requestPaint() }
            }
        }

        Text {
            Layout.fillWidth: true
            text: root.running ? "停止" : "启动"
            color: "#FFFFFF"
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            font {
                family: "Microsoft YaHei UI"
                pixelSize: 15
                weight: Font.DemiBold
            }
        }

        Item {
            Layout.preferredWidth: 18
            Layout.preferredHeight: 18
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        enabled: root.enabled
        cursorShape: Qt.PointingHandCursor
        onClicked: root.clicked()
    }
}
